import { Sequelize } from "sequelize";
import { createFdwLogger, FdwLogger } from "./fdw.logger";
import { FDWServer, LogLevel } from "./fdw.types";

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
      await this.sequelize.query(`CREATE EXTENSION IF NOT EXISTS postgres_fdw;`)
    //   await this.init_servers();
    } catch (error) {
      this.logger.error(error);
    }
  }

  async init_server(server: FDWServer): Promise<any> {
    try {
      const sequelizeOptions = (this.sequelize as any)?.options ?? {};
      const sequelizeState = this.sequelize as SequelizeWithFdwState;

      if (!sequelizeState.__fdwInitializedServers) {
        sequelizeState.__fdwInitializedServers = new Set<string>();
      }
      if (!sequelizeState.__fdwServerInitPromises) {
        sequelizeState.__fdwServerInitPromises = new Map<string, Promise<any>>();
      }

      if (sequelizeState.__fdwInitializedServers.has(server.name)) {
        this.logger.debug(`Skipping FDW server (already initialized): ${server.name}`)
        return null
      }

      const inFlightInit = sequelizeState.__fdwServerInitPromises.get(server.name);
      if (inFlightInit) {
        this.logger.debug(`Waiting for in-progress FDW server init: ${server.name}`)
        await inFlightInit;
        return null
      }

      const shouldRecreate = Boolean(sequelizeOptions.autoLoadModels && sequelizeOptions.synchronize);
      if(!server.dbName) {
          this.logger.error(`Missing dbName for foreign table, read ${server.name} (${server.dbName})`)
          return null
      }

      this.logger.debug(`Initializing FDW server: ${server.name} (${server.dbName})`)
      const initializePromise = this.run_init_server_query(server, shouldRecreate);
      sequelizeState.__fdwServerInitPromises.set(server.name, initializePromise);

      const result = await initializePromise;
      sequelizeState.__fdwInitializedServers.add(server.name);
      return result
    } catch (error) {
      this.logger.error(error);
      return null
    } finally {
      const sequelizeState = this.sequelize as SequelizeWithFdwState;
      sequelizeState.__fdwServerInitPromises?.delete(server.name);
    }
  }

  private run_init_server_query(server: FDWServer, shouldRecreate: boolean): Promise<any> {
    if (shouldRecreate) {
      return this.sequelize.query(`
          -- Enable FDW extension
          CREATE EXTENSION IF NOT EXISTS postgres_fdw;

          -- Drop old server if it exists (safe re-run)
          DROP SERVER IF EXISTS ${server.name} CASCADE;

          -- Recreate FDW server
          CREATE SERVER ${server.name}
          FOREIGN DATA WRAPPER postgres_fdw
          OPTIONS (host '${server.host}', dbname '${server.dbName}', port '${server.dbPort}');

          -- Drop old user mapping if it exists
          DROP USER MAPPING IF EXISTS FOR CURRENT_USER SERVER ${server.name};

          -- Recreate user mapping
          CREATE USER MAPPING FOR CURRENT_USER
          SERVER ${server.name}
          OPTIONS (user '${server.dbUser}', password '${server.dbPass}');
      `)
    }

    return this.sequelize.query(`
      -- Enable FDW extension
      CREATE EXTENSION IF NOT EXISTS postgres_fdw;

      -- Create server only when it is missing
      DO $$
      BEGIN
      IF NOT EXISTS (
          SELECT 1
          FROM pg_foreign_server
          WHERE srvname = '${server.name}'
      ) THEN
          CREATE SERVER ${server.name}
          FOREIGN DATA WRAPPER postgres_fdw
          OPTIONS (host '${server.host}', dbname '${server.dbName}', port '${server.dbPort}');
      END IF;
      END
      $$;

      -- Create user mapping only when it is missing
      DO $$
      BEGIN
      IF NOT EXISTS (
          SELECT 1
          FROM pg_user_mappings
          WHERE srvname = '${server.name}'
          AND usename = CURRENT_USER
      ) THEN
          CREATE USER MAPPING FOR CURRENT_USER
          SERVER ${server.name}
          OPTIONS (user '${server.dbUser}', password '${server.dbPass}');
      END IF;
      END
      $$;
    `)
  }
}

export class ForeignTableQueryBuilder {

  private fields: ForeignTableBuilderFields[] = []
  private schema: string
  private tableName: string
  private server: string
  private extension?: string

  constructor(tableName: string, connection: string, extension?: string, schema: string = "public") {
    this.tableName = tableName
    this.server = connection
    this.schema = schema
    this.extension = extension
  }

  addField(field: ForeignTableBuilderFields) {
    this.fields.push(field)
    return this;
  }

  build(): string {
    const ftName = `public.${this.tableName}${this.extension? `_${this.extension}` : ''}`;
    return `
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = '${this.tableName}${this.extension? `_${this.extension}` : ''}'
            AND table_type = 'BASE TABLE'
        ) THEN
          EXECUTE 'DROP TABLE IF EXISTS ${ftName} CASCADE';
        END IF;
      END $$;
      DROP FOREIGN TABLE IF EXISTS ${ftName};
      CREATE FOREIGN TABLE ${ftName} (
        ${this.fields.map((field) => {
      return `"${field.name}" ${field.type}`
    }).join(",\n")}
      )
      SERVER ${this.server}
      OPTIONS (schema_name '${this.schema}', table_name '${this.tableName}');
    `
  }
}

type ForeignTableBuilderFields = {
  name: string;
  type: "uuid" | "uuid[]" | "text" | "double precision" | "integer" | "timestamp" | "boolean" | "JSON" | "JSONB" | any
}