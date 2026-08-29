import { Sequelize } from "sequelize";
import { createFdwLogger, FdwLogger } from "./fdw.logger";
import { FDWServer, LogLevel } from "./fdw.types";

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function escapeLiteral(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function buildInitFdwSql(): string {
  return `CREATE EXTENSION IF NOT EXISTS postgres_fdw;`;
}

export function buildInitServerSql(server: FDWServer, shouldRecreate: boolean): string {
  const quotedServerName = quoteIdentifier(server.name);
  const serverNameLiteral = escapeLiteral(server.name);
  const hostLiteral = escapeLiteral(server.host);
  const dbNameLiteral = escapeLiteral(server.dbName);
  const dbPortLiteral = escapeLiteral(String(server.dbPort));
  const dbUserLiteral = escapeLiteral(server.dbUser);
  const dbPassLiteral = escapeLiteral(server.dbPass);

  if (shouldRecreate) {
    return `
      -- Enable FDW extension
      CREATE EXTENSION IF NOT EXISTS postgres_fdw;

      -- Drop old server if it exists (safe re-run)
      DROP SERVER IF EXISTS ${quotedServerName} CASCADE;

      -- Recreate FDW server
      CREATE SERVER ${quotedServerName}
      FOREIGN DATA WRAPPER postgres_fdw
      OPTIONS (host ${hostLiteral}, dbname ${dbNameLiteral}, port ${dbPortLiteral});

      -- Drop old user mapping if it exists
      DROP USER MAPPING IF EXISTS FOR CURRENT_USER SERVER ${quotedServerName};

      -- Recreate user mapping
      CREATE USER MAPPING FOR CURRENT_USER
      SERVER ${quotedServerName}
      OPTIONS (user ${dbUserLiteral}, password ${dbPassLiteral});
    `;
  }

  return `
    -- Enable FDW extension
    CREATE EXTENSION IF NOT EXISTS postgres_fdw;

    -- Create server only when it is missing
    DO $$
    BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_foreign_server
        WHERE srvname = ${serverNameLiteral}
    ) THEN
        CREATE SERVER ${quotedServerName}
        FOREIGN DATA WRAPPER postgres_fdw
        OPTIONS (host ${hostLiteral}, dbname ${dbNameLiteral}, port ${dbPortLiteral});
    END IF;
    END
    $$;

    -- Create user mapping only when it is missing
    DO $$
    BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_user_mappings
        WHERE srvname = ${serverNameLiteral}
        AND usename = CURRENT_USER
    ) THEN
        CREATE USER MAPPING FOR CURRENT_USER
        SERVER ${quotedServerName}
        OPTIONS (user ${dbUserLiteral}, password ${dbPassLiteral});
    END IF;
    END
    $$;
  `;
}

type SequelizeWithFdwState = Sequelize & {
  __fdwInitializedServers?: Set<string>;
  __fdwServerInitPromises?: Map<string, Promise<any>>;
};

export class FDWInjector {
  private readonly logger: FdwLogger;

  constructor(
    private sequelize: Sequelize,
    logLevel: LogLevel = "error"
  ) {
    this.logger = createFdwLogger(FDWInjector.name, logLevel);
  }

  async init_fdw(): Promise<void> {
    try {
      await this.sequelize.query(buildInitFdwSql());
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  async init_server(server: FDWServer): Promise<any> {
    const sequelizeOptions = (this.sequelize as any)?.options ?? {};
    const sequelizeState = this.sequelize as SequelizeWithFdwState;

    if (!sequelizeState.__fdwInitializedServers) {
      sequelizeState.__fdwInitializedServers = new Set<string>();
    }
    if (!sequelizeState.__fdwServerInitPromises) {
      sequelizeState.__fdwServerInitPromises = new Map<string, Promise<any>>();
    }

    if (sequelizeState.__fdwInitializedServers.has(server.name)) {
      this.logger.debug(`Skipping FDW server (already initialized): ${server.name}`);
      return null;
    }

    const inFlightInit = sequelizeState.__fdwServerInitPromises.get(server.name);
    if (inFlightInit) {
      this.logger.debug(`Waiting for in-progress FDW server init: ${server.name}`);
      return await inFlightInit;
    }

    const shouldRecreate = Boolean(sequelizeOptions.autoLoadModels && sequelizeOptions.synchronize);
    if (!server.dbName) {
      const errorMsg = `Missing dbName for foreign table server: ${server.name}`;
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    this.logger.debug(`Initializing FDW server: ${server.name} (${server.dbName})`);
    const initializePromise = this.run_init_server_query(server, shouldRecreate);
    sequelizeState.__fdwServerInitPromises.set(server.name, initializePromise);

    try {
      const result = await initializePromise;
      sequelizeState.__fdwInitializedServers.add(server.name);
      return result;
    } catch (error: any) {
      this.logger.error(error?.message || error);
      throw error;
    } finally {
      sequelizeState.__fdwServerInitPromises.delete(server.name);
    }
  }

  private run_init_server_query(server: FDWServer, shouldRecreate: boolean): Promise<any> {
    return this.sequelize.query(buildInitServerSql(server, shouldRecreate));
  }
}

export type ForeignTableBuilderFields = {
  name: string;
  type: string;
};

export class ForeignTableQueryBuilder {
  private fields: ForeignTableBuilderFields[] = [];
  private foreignSchema: string;
  private localSchema: string;
  private tableName: string;
  private server: string;

  constructor(
    tableName: string,
    connection: string,
    foreignSchema: string = "public",
    localSchema: string = "public"
  ) {
    this.tableName = tableName;
    this.server = connection;
    this.foreignSchema = foreignSchema;
    this.localSchema = localSchema;
  }

  addField(field: ForeignTableBuilderFields) {
    this.fields.push(field);
    return this;
  }

  build(): string {
    const quotedLocalSchema = quoteIdentifier(this.localSchema);
    const quotedTableName = quoteIdentifier(this.tableName);
    const localFtName = `${quotedLocalSchema}.${quotedTableName}`;
    const escapedLocalSchema = escapeLiteral(this.localSchema);
    const escapedTableName = escapeLiteral(this.tableName);
    const quotedServer = quoteIdentifier(this.server);
    const foreignSchemaLiteral = escapeLiteral(this.foreignSchema);
    const tableNameLiteral = escapeLiteral(this.tableName);

    return `
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = ${escapedLocalSchema}
            AND table_name = ${escapedTableName}
            AND table_type = 'BASE TABLE'
        ) THEN
          EXECUTE 'DROP TABLE IF EXISTS ${quotedLocalSchema.replace(/'/g, "''")}.${quotedTableName.replace(/'/g, "''")} CASCADE';
        END IF;
      END $$;
      CREATE SCHEMA IF NOT EXISTS ${quotedLocalSchema};
      DROP FOREIGN TABLE IF EXISTS ${localFtName};
      CREATE FOREIGN TABLE ${localFtName} (
        ${this.fields.map((field) => `${quoteIdentifier(field.name)} ${field.type}`).join(",\n        ")}
      )
      SERVER ${quotedServer}
      OPTIONS (schema_name ${foreignSchemaLiteral}, table_name ${tableNameLiteral});
    `;
  }
}