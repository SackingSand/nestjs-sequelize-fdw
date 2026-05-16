import { DataTypes } from "sequelize";
import { Model } from "sequelize-typescript";
import { createFdwLogger, FdwLogger } from "./fdw.logger";
import { FDWInjector, ForeignTableQueryBuilder } from "./fdw.injector";
import { FFDWDecorator } from "./fdw.types";

export class BaseFDWModel<T extends {}> extends Model<T> {

  // ✅ Enhanced sync: auto-create enum types BEFORE FDW table
  static override sync(): Promise<any> {
    const attributes = this.getAttributes()
    const { server, log_level }: FFDWDecorator = Reflect.getMetadata("fdw:meta", this)
    const logger = createFdwLogger(this.name, log_level ?? "error")
    
    if (!server) {
      logger.error(`Missing server Metadata for: ${super.getTableName()}`)
      return Promise.resolve(this)
    }

    const sequelize = this.sequelize
    if (!sequelize) {
      logger.error(`Missing sequelize instance for: ${super.getTableName()}`)
      return Promise.resolve(this)
    }

    // ✅ Step 1: Collect ENUM types needed
    const enumTypesToCreate: { typeName: string; values: string[] }[] = []
    const tableQuery = new ForeignTableQueryBuilder(super.getTableName().toString(), server.name)

    for (const [property, meta] of Object.entries(attributes)) {

      const columnName = (meta as any).field ?? property;

      const tsType = sequelizeTypeToTs(
        (meta as any).type,
        columnName,
        super.getTableName().toString(),
        enumTypesToCreate,
        logger
      );

      if (typeof tsType === 'object' && tsType.isEnum) {
        enumTypesToCreate.push({
          typeName: tsType.typeName,
          values: tsType.values
        });

        tableQuery.addField({
          name: columnName,
          type: tsType.typeName
        });

      } else {
        tableQuery.addField({
          name: columnName,
          type: tsType as string
        });
      }
    }

    // ✅ Step 2: Build safe enum creation statements (using DO block)
    const enumCreationScripts = enumTypesToCreate.map(enumInfo => {
      const valuesStr = enumInfo.values.map(v => `'${v.replace(/'/g, "''")}'`).join(', ')
      return `
        DO $$ 
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_type 
            WHERE typname = '${enumInfo.typeName.split('.').pop()}' 
              AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = '${enumInfo.typeName.split('.')[0] || 'public'}')
          ) THEN
            CREATE TYPE ${enumInfo.typeName} AS ENUM (${valuesStr});
          END IF;
        END$$;
        `
    }).join('\n')

    // ✅ Step 3: Build FDW table creation
    const fdwTableScript = tableQuery.build()
    // this.logger.debug(fdwTableScript)
    // ✅ Step 4: Combine all scripts
    const fullScript = `${enumCreationScripts}\n${fdwTableScript}`

    const injector = new FDWInjector(sequelize, log_level ?? "error")
    return injector.init_fdw()
      .then(() => {
        return injector.init_server(server)
      })
      .then(() => {
        return sequelize.query(fullScript, { transaction: null })
      })
      .then(() => {
        return Promise.resolve(this)
      })
      .catch((err) => {
        logger.error(`Failed to create FDW table for ${super.getTableName()}:`, err)
        return Promise.resolve(this)
      })
  }

  static override drop(): Promise<any> {
    return Promise.resolve(this)
  }

}

export function FDWMetadata({ server, log_level }: FFDWDecorator) {
  return (target: Function) => Reflect.defineMetadata("fdw:meta", { server, log_level }, target)
}

// ✅ Enhanced type converter that collects enum info
interface EnumTypeInfo {
  isEnum: true;
  values: string[];
  typeName: string;
}

function sequelizeTypeToTs(
  type: any, 
  columnName?: string, 
  tableName?: string,
  enumCollector?: { typeName: string; values: string[] }[], // Optional collector
  logger?: FdwLogger
): string | EnumTypeInfo {
  if (type instanceof DataTypes.UUID) return 'uuid';
  if (type instanceof DataTypes.STRING) return 'text';
  if (type instanceof DataTypes.TEXT) return 'text';
  if (type instanceof DataTypes.INTEGER) return 'integer';
  if (type instanceof DataTypes.DECIMAL) return 'numeric(10,2)'; // More accurate than double precision
  if (type instanceof DataTypes.DOUBLE) return 'double precision';
  if (type instanceof DataTypes.BOOLEAN) return 'boolean';
  if (type instanceof DataTypes.DATE) return 'timestamp';
  if (type instanceof DataTypes.DATEONLY) return 'date'; // ✅ Fix: DATEONLY should be 'date', not 'timestamp'
  if (type instanceof DataTypes.JSON) return 'json';
  if (type instanceof DataTypes.JSONB) return 'jsonb';

  // ✅ ENUM handling with proper type name generation
  if (type instanceof DataTypes.ENUM) {
    const values = (type as any).values || []
    
    if (tableName && columnName) {
      // Convert camelCase to snake_case: paymentStatus → payment_status
      const snakeCaseCol = columnName.replace(/([A-Z])/g, '_$1').toLowerCase()
      const schema = 'public'
      const typeName = `${schema}.enum_${tableName}_${snakeCaseCol}`
      
      return {
        isEnum: true,
        values,
        typeName
      }
    }
    
    logger?.warn(`ENUM column '${columnName}' missing tableName context - fallback to TEXT`)
    return 'text'
  }

  if (type instanceof DataTypes.ARRAY) {
    const innerType = sequelizeTypeToTs((type as any).type, undefined, undefined)
    if (typeof innerType === 'string') {
      return `${innerType}[]`
    }
    return 'text[]' // Safe fallback
  }

  return 'text' // default fallback
}