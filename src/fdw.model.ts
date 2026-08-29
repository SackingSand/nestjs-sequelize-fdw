import "reflect-metadata";
import { DataTypes } from "sequelize";
import { Model } from "sequelize-typescript";
import { createFdwLogger, FdwLogger } from "./fdw.logger";
import {
  buildInitFdwSql,
  buildInitServerSql,
  escapeLiteral,
  FDWInjector,
  ForeignTableQueryBuilder,
  quoteIdentifier,
} from "./fdw.injector";
import { FDWDecorator } from "./fdw.types";

export type FdwSqlBuildOptions = {
  includeInfrastructure?: boolean;
  recreateServer?: boolean;
  dropServerOnDown?: boolean;
  dropEnumsOnDown?: boolean;
  dropSchemaOnDown?: boolean;
  strict?: boolean;
  allowUnsafeSchemaDrop?: boolean;
};

export type FdwMigrationPlan = {
  upSql: string[];
  downSql: string[];
};

export class FDWModel<T extends {} = any> extends Model<T> {
  // Enhanced sync: auto-create enum types BEFORE FDW table
  static override async sync(): Promise<any> {
    const metadata: FDWDecorator | undefined = Reflect.getMetadata("fdw:meta", this);
    const { server, log_level } = metadata ?? {};
    const logger = createFdwLogger(this.name, log_level ?? "error");

    if (!server) {
      const errorMsg = `Missing server Metadata for FDW model: ${String(this.getTableName())}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    const sequelize = this.sequelize;
    if (!sequelize) {
      const errorMsg = `Missing sequelize instance for FDW model: ${String(this.getTableName())}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    const plan = this.buildFdwMigrationPlan();
    const injector = new FDWInjector(sequelize, log_level ?? "error");

    try {
      await injector.init_fdw();
      await injector.init_server(server);
      await runSqlStatements(sequelize, plan.upSql);
      return this;
    } catch (err: any) {
      logger.error(`Failed to create FDW table for ${String(this.getTableName())}:`, err?.message || err);
      throw err;
    }
  }

  static override async drop(): Promise<any> {
    const metadata: FDWDecorator | undefined = Reflect.getMetadata("fdw:meta", this);
    const { log_level } = metadata ?? {};
    const logger = createFdwLogger(this.name, log_level ?? "error");
    const sequelize = this.sequelize;

    if (!sequelize) {
      const errorMsg = `Missing sequelize instance for FDW model: ${String(this.getTableName())}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    const sql = this.buildFdwDownSql();
    try {
      await runSqlStatements(sequelize, sql);
      return this;
    } catch (err: any) {
      logger.error(`Failed to drop FDW table for ${String(this.getTableName())}:`, err?.message || err);
      throw err;
    }
  }

  static buildFdwMigrationPlan(options: FdwSqlBuildOptions = {}): FdwMigrationPlan {
    return buildFdwMigrationPlan(this as unknown as typeof FDWModel, options);
  }

  static buildFdwUpSql(options: FdwSqlBuildOptions = {}): string[] {
    return this.buildFdwMigrationPlan(options).upSql;
  }

  static buildFdwDownSql(options: FdwSqlBuildOptions = {}): string[] {
    return this.buildFdwMigrationPlan(options).downSql;
  }
}

export function FDWMetadata(metadata: FDWDecorator) {
  return (target: Function) => Reflect.defineMetadata("fdw:meta", metadata, target);
}

export function buildFdwMigrationPlan(
  model: typeof FDWModel,
  options: FdwSqlBuildOptions = {}
): FdwMigrationPlan {
  const metadata: FDWDecorator = Reflect.getMetadata("fdw:meta", model) ?? {};
  const { server, log_level, foreign_schema, local_schema } = metadata;
  const logger = createFdwLogger(model.name, log_level ?? "error");
  const { tableName, schema: modelSchema } = getTableDetails(model.getTableName());
  const targetForeignSchema = foreign_schema ?? "public";
  const targetLocalSchema = local_schema ?? modelSchema ?? "public";
  const strictMode = Boolean(options.strict);

  if (!server) {
    const message = `Missing server Metadata for: ${String(model.getTableName())}`;
    logger.error(message);
    if (strictMode) {
      throw new Error(message);
    }
    return {
      upSql: [],
      downSql: [],
    };
  }

  const attributes = model.getAttributes ? model.getAttributes() : {};
  const enumTypesToCreate: EnumTypeInfo[] = [];
  const tableQuery = new ForeignTableQueryBuilder(
    tableName,
    server.name,
    targetForeignSchema,
    targetLocalSchema
  );

  for (const [property, meta] of Object.entries(attributes)) {
    const columnName = (meta as any).field ?? property;
    const tsType = sequelizeTypeToPostgres(
      (meta as any).type,
      columnName,
      tableName,
      targetLocalSchema,
      logger
    );

    if (typeof tsType === "object" && tsType.isEnum) {
      enumTypesToCreate.push(tsType);
      tableQuery.addField({
        name: columnName,
        type: tsType.typeName,
      });
      continue;
    }

    tableQuery.addField({
      name: columnName,
      type: tsType as string,
    });
  }

  const uniqueEnumTypes = dedupeEnumTypes(enumTypesToCreate);
  const enumCreationScripts = uniqueEnumTypes.map(buildEnumTypeSql);
  const fdwTableScript = tableQuery.build();

  const quotedLocalSchema = quoteIdentifier(targetLocalSchema);
  const quotedTableName = quoteIdentifier(tableName);

  const upSql: string[] = [];
  if (options.includeInfrastructure) {
    upSql.push(buildInitFdwSql());
    upSql.push(buildInitServerSql(server, Boolean(options.recreateServer)));
  }
  upSql.push(`CREATE SCHEMA IF NOT EXISTS ${quotedLocalSchema};`);
  upSql.push(...enumCreationScripts);
  upSql.push(fdwTableScript);

  const downSql: string[] = [
    `DROP FOREIGN TABLE IF EXISTS ${quotedLocalSchema}.${quotedTableName};`,
  ];

  if (options.dropEnumsOnDown) {
    for (const enumInfo of uniqueEnumTypes) {
      downSql.push(`DROP TYPE IF EXISTS ${enumInfo.typeName} CASCADE;`);
    }
  }

  if (options.dropSchemaOnDown) {
    const isPublicSchema = targetLocalSchema.toLowerCase() === "public";
    if (isPublicSchema && !options.allowUnsafeSchemaDrop) {
      const message = `Refusing to drop schema 'public' for ${String(model.getTableName())}. Set allowUnsafeSchemaDrop to true to override.`;
      logger.error(message);
      if (strictMode) {
        throw new Error(message);
      }
    } else {
      downSql.push(`DROP SCHEMA IF EXISTS ${quotedLocalSchema} CASCADE;`);
    }
  }

  if (options.dropServerOnDown) {
    downSql.push(`DROP SERVER IF EXISTS ${quoteIdentifier(server.name)} CASCADE;`);
  }

  return { upSql, downSql };
}

export interface EnumTypeInfo {
  isEnum: true;
  schema: string;
  enumName: string;
  values: string[];
  typeName: string;
}

export function extractTypeKey(type: any): string {
  if (!type) return "";
  if (typeof type === "string") return type.toUpperCase();
  if (typeof type === "function") {
    return (type.key || type.name || type.prototype?.key || "").toUpperCase();
  }
  return (
    type.key ||
    type.constructor?.key ||
    type.constructor?.name ||
    type.name ||
    ""
  ).toUpperCase();
}

export function sequelizeTypeToPostgres(
  type: any,
  columnName?: string,
  tableName?: string,
  enumSchema: string = "public",
  logger?: FdwLogger
): string | EnumTypeInfo {
  if (!type) return "text";

  const key = extractTypeKey(type);

  // Check specific types first by key, or fallback to exact instance types
  if (key === "UUID") return "uuid";
  if (key === "CITEXT") return "citext";
  if (key === "CHAR") {
    const length = typeof type === "function" ? undefined : (type.options?.length ?? (type as any)._length);
    return length ? `char(${length})` : "char";
  }
  if (key === "TEXT") return "text";
  if (key === "STRING") return "text";
  if (key === "SMALLINT") return "smallint";
  if (key === "BIGINT") return "bigint";
  if (key === "INTEGER") return "integer";
  if (key === "BOOLEAN") return "boolean";
  if (key === "DATEONLY") return "date";
  if (key === "DATE") return "timestamp";
  if (key === "TIME") return "time";
  if (key === "DOUBLE" || key === "DOUBLE PRECISION") return "double precision";
  if (key === "REAL") return "real";
  if (key === "FLOAT") {
    const len = type.options?.length ?? (type as any)._length;
    return len && len <= 24 ? "real" : "double precision";
  }
  if (key === "DECIMAL" || key === "NUMERIC") {
    const precision = type.options?.precision ?? (type as any)._precision ?? (type as any).precision;
    const scale = type.options?.scale ?? (type as any)._scale ?? (type as any).scale;
    if (precision !== undefined) {
      return scale !== undefined ? `numeric(${precision},${scale})` : `numeric(${precision})`;
    }
    return "numeric";
  }
  if (key === "INET") return "inet";
  if (key === "MACADDR") return "macaddr";
  if (key === "BLOB" || key === "BYTEA") return "bytea";
  if (key === "JSONB") return "jsonb";
  if (key === "JSON") return "json";

  // ENUM handling with proper type name generation
  if (key === "ENUM" || type instanceof DataTypes.ENUM) {
    const values: string[] = type.values || (type as any).options?.values || [];

    if (tableName && columnName) {
      // Convert camelCase to snake_case and strip leading underscore
      const snakeCaseCol = columnName
        .replace(/([A-Z])/g, "_$1")
        .toLowerCase()
        .replace(/^_/, "");
      const sanitizedTableName = tableName.replace(/[^a-zA-Z0-9_]/g, "_");
      const enumName = `enum_${sanitizedTableName}_${snakeCaseCol}`;
      const schema = enumSchema || "public";
      const typeName = `${quoteIdentifier(schema)}.${quoteIdentifier(enumName)}`;

      return {
        isEnum: true,
        schema,
        enumName,
        values,
        typeName,
      };
    }

    logger?.warn(`ENUM column '${columnName}' missing tableName context - fallback to text`);
    return "text";
  }

  if (key === "ARRAY" || type instanceof DataTypes.ARRAY) {
    const innerTypeObj = type.type || (type as any).options?.type;
    const innerType = sequelizeTypeToPostgres(innerTypeObj, undefined, undefined, enumSchema, logger);
    if (typeof innerType === "string") {
      return `${innerType}[]`;
    }
    return "text[]";
  }

  return "text";
}

function dedupeEnumTypes(enumTypes: EnumTypeInfo[]): EnumTypeInfo[] {
  const map = new Map<string, EnumTypeInfo>();

  for (const enumType of enumTypes) {
    if (!map.has(enumType.typeName)) {
      map.set(enumType.typeName, enumType);
    }
  }

  return Array.from(map.values());
}

export function buildEnumTypeSql(enumInfo: EnumTypeInfo | { schema?: string; enumName?: string; typeName: string; values: string[] }): string {
  const schema = (enumInfo as any).schema ?? (enumInfo.typeName.split(".")[0]?.replace(/"/g, "") || "public");
  const enumName = (enumInfo as any).enumName ?? (enumInfo.typeName.split(".").pop()?.replace(/"/g, "") || enumInfo.typeName.replace(/"/g, ""));
  const quotedSchema = quoteIdentifier(schema);
  const quotedEnumName = quoteIdentifier(enumName);
  const qualifiedTypeName = `${quotedSchema}.${quotedEnumName}`;
  const valuesStr = enumInfo.values.map((value) => escapeLiteral(value)).join(", ");
  const schemaLiteral = escapeLiteral(schema);
  const enumNameLiteral = escapeLiteral(enumName);

  return `
    DO $$ 
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type 
        WHERE typname = ${enumNameLiteral} 
          AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = ${schemaLiteral})
      ) THEN
        CREATE TYPE ${qualifiedTypeName} AS ENUM (${valuesStr});
      END IF;
    END$$;
  `.trim();
}

async function runSqlStatements(
  sequelize: NonNullable<Model["sequelize"]>,
  statements: string[]
): Promise<void> {
  for (const sql of statements) {
    if (!sql.trim()) {
      continue;
    }

    await sequelize.query(sql, { transaction: null });
  }
}

function getTableDetails(tableRef: any): { tableName: string; schema?: string } {
  if (typeof tableRef === "string") {
    return { tableName: tableRef };
  }

  if (tableRef && typeof tableRef === "object") {
    const tableName = tableRef.tableName ?? tableRef.table ?? tableRef.name;
    const schema = tableRef.schema;

    if (typeof tableName === "string") {
      return { tableName, schema };
    }
  }

  return { tableName: String(tableRef) };
}