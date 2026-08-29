import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import "reflect-metadata";
import { DataTypes } from "sequelize";
import { Column, Table, PrimaryKey, Sequelize } from "sequelize-typescript";
import {
  quoteIdentifier,
  escapeLiteral,
  buildInitFdwSql,
  buildInitServerSql,
  ForeignTableQueryBuilder,
  buildEnumTypeSql,
  sequelizeTypeToPostgres,
  FDWModel,
  FDWMetadata,
  FDWInjector,
} from "../src";

describe("SQL Safety & Escaping Utilities", () => {
  it("quotes standard identifiers and escapes embedded quotes", () => {
    assert.equal(quoteIdentifier("users"), '"users"');
    assert.equal(quoteIdentifier('user"table'), '"user""table"');
    assert.equal(quoteIdentifier("schema-with-dash"), '"schema-with-dash"');
    assert.equal(quoteIdentifier("UserOrder"), '"UserOrder"');
  });

  it("escapes single quotes in string literals", () => {
    assert.equal(escapeLiteral("hello"), "'hello'");
    assert.equal(escapeLiteral("p'a$sw0rd'"), "'p''a$sw0rd'''");
    assert.equal(escapeLiteral("5432"), "'5432'");
  });
});

describe("DDL SQL Generation", () => {
  it("generates correct extension initialization SQL", () => {
    assert.equal(buildInitFdwSql(), "CREATE EXTENSION IF NOT EXISTS postgres_fdw;");
  });

  it("generates server init SQL with properly escaped credentials", () => {
    const server = {
      name: 'remote_db"test',
      host: "db.example.com",
      dbName: "remote_db",
      dbUser: "admin'user",
      dbPass: "s3cr'et",
      dbPort: "5432",
    };

    const sql = buildInitServerSql(server, false);
    assert.ok(sql.includes('CREATE SERVER "remote_db""test"'));
    assert.ok(sql.includes("OPTIONS (user 'admin''user', password 's3cr''et')"));
    assert.ok(sql.includes("WHERE srvname = 'remote_db\"test'"));

    const recreateSql = buildInitServerSql(server, true);
    assert.ok(recreateSql.includes('DROP SERVER IF EXISTS "remote_db""test" CASCADE;'));
  });

  it("builds foreign table DDL with correct schema and types", () => {
    const builder = new ForeignTableQueryBuilder(
      "orders",
      "remote_server",
      "remote_schema",
      "local_schema"
    );

    builder.addField({ name: "id", type: "uuid" });
    builder.addField({ name: "total_amount", type: "numeric(10,2)" });

    const sql = builder.build();
    assert.ok(sql.includes('CREATE FOREIGN TABLE "local_schema"."orders"'));
    assert.ok(sql.includes('"id" uuid'));
    assert.ok(sql.includes('"total_amount" numeric(10,2)'));
    assert.ok(sql.includes('SERVER "remote_server"'));
    assert.ok(sql.includes("OPTIONS (schema_name 'remote_schema', table_name 'orders')"));
  });
});

describe("Data Type Mapping", () => {
  it("maps primitive and advanced types correctly", () => {
    assert.equal(sequelizeTypeToPostgres(DataTypes.UUID), "uuid");
    assert.equal(sequelizeTypeToPostgres(DataTypes.STRING), "text");
    assert.equal(sequelizeTypeToPostgres(DataTypes.TEXT), "text");
    assert.equal(sequelizeTypeToPostgres(DataTypes.INTEGER), "integer");
    assert.equal(sequelizeTypeToPostgres(DataTypes.BIGINT), "bigint");
    assert.equal(sequelizeTypeToPostgres(DataTypes.SMALLINT), "smallint");
    assert.equal(sequelizeTypeToPostgres(DataTypes.BOOLEAN), "boolean");
    assert.equal(sequelizeTypeToPostgres(DataTypes.DATE), "timestamp");
    assert.equal(sequelizeTypeToPostgres(DataTypes.DATEONLY), "date");
    assert.equal(sequelizeTypeToPostgres(DataTypes.TIME), "time");
    assert.equal(sequelizeTypeToPostgres(DataTypes.DOUBLE), "double precision");
    assert.equal(sequelizeTypeToPostgres(DataTypes.REAL), "real");
    assert.equal(sequelizeTypeToPostgres(DataTypes.BLOB), "bytea");
    assert.equal(sequelizeTypeToPostgres(DataTypes.INET), "inet");
    assert.equal(sequelizeTypeToPostgres(DataTypes.CITEXT), "citext");
    assert.equal(sequelizeTypeToPostgres(DataTypes.MACADDR), "macaddr");
    assert.equal(sequelizeTypeToPostgres(DataTypes.JSON), "json");
    assert.equal(sequelizeTypeToPostgres(DataTypes.JSONB), "jsonb");
  });

  it("handles decimal with precision and scale", () => {
    assert.equal(sequelizeTypeToPostgres(DataTypes.DECIMAL(12, 4)), "numeric(12,4)");
    assert.equal(sequelizeTypeToPostgres(DataTypes.DECIMAL(8)), "numeric(8)");
    assert.equal(sequelizeTypeToPostgres(DataTypes.DECIMAL), "numeric");
  });

  it("handles CHAR with length", () => {
    assert.equal(sequelizeTypeToPostgres(DataTypes.CHAR(10)), "char(10)");
    assert.equal(sequelizeTypeToPostgres(DataTypes.CHAR), "char");
  });

  it("handles ARRAY types", () => {
    assert.equal(sequelizeTypeToPostgres(DataTypes.ARRAY(DataTypes.INTEGER)), "integer[]");
    assert.equal(sequelizeTypeToPostgres(DataTypes.ARRAY(DataTypes.UUID)), "uuid[]");
  });

  it("handles ENUM with sanitized snake_case name without leading underscores", () => {
    const enumInfo = sequelizeTypeToPostgres(
      DataTypes.ENUM("pending", "approved"),
      "PaymentStatus",
      "payments",
      "custom_schema"
    );

    assert.equal(typeof enumInfo, "object");
    if (typeof enumInfo === "object" && enumInfo.isEnum) {
      assert.equal(enumInfo.schema, "custom_schema");
      assert.equal(enumInfo.enumName, "enum_payments_payment_status");
      assert.equal(enumInfo.typeName, '"custom_schema"."enum_payments_payment_status"');
      assert.deepEqual(enumInfo.values, ["pending", "approved"]);

      const enumSql = buildEnumTypeSql(enumInfo);
      assert.ok(enumSql.includes("CREATE TYPE \"custom_schema\".\"enum_payments_payment_status\" AS ENUM ('pending', 'approved')"));
    }
  });
});

describe("Migration Plan Generation", () => {
  @FDWMetadata({
    server: {
      name: "foreign_server",
      host: "remote.host",
      dbName: "remote_db",
      dbUser: "user",
      dbPass: "pass",
      dbPort: "5432",
    },
    foreign_schema: "remote_schema",
    local_schema: "fdw_schema",
  })
  @Table({
    tableName: "sample_items",
    schema: "fdw_schema",
  })
  class SampleItem extends FDWModel<SampleItem> {
    @PrimaryKey
    @Column(DataTypes.UUID)
    id!: string;

    @Column(DataTypes.STRING)
    name!: string;

    @Column(DataTypes.ENUM("a", "b"))
    category!: "a" | "b";
  }

  @FDWMetadata({
    server: {
      name: "foreign_server",
      host: "remote.host",
      dbName: "remote_db",
      dbUser: "user",
      dbPass: "pass",
      dbPort: "5432",
    },
    local_schema: "public",
  })
  @Table({
    tableName: "public_items",
    schema: "public",
  })
  class PublicItem extends FDWModel<PublicItem> {
    @PrimaryKey
    @Column(DataTypes.UUID)
    id!: string;
  }

  // Initialize models with a Sequelize instance
  new Sequelize({
    dialect: "postgres",
    models: [SampleItem, PublicItem],
  });

  it("generates complete up and down migration plans", () => {
    const plan = SampleItem.buildFdwMigrationPlan({
      includeInfrastructure: true,
      dropEnumsOnDown: true,
      dropSchemaOnDown: true,
      dropServerOnDown: true,
      strict: true,
    });

    assert.ok(plan.upSql.some((s) => s.includes("CREATE EXTENSION IF NOT EXISTS postgres_fdw;")));
    assert.ok(plan.upSql.some((s) => s.includes('CREATE SCHEMA IF NOT EXISTS "fdw_schema";')));
    assert.ok(plan.upSql.some((s) => s.includes('CREATE FOREIGN TABLE "fdw_schema"."sample_items"')));

    assert.ok(plan.downSql.some((s) => s.includes('DROP FOREIGN TABLE IF EXISTS "fdw_schema"."sample_items";')));
    assert.ok(plan.downSql.some((s) => s.includes('DROP TYPE IF EXISTS "fdw_schema"."enum_sample_items_category" CASCADE;')));
    assert.ok(plan.downSql.some((s) => s.includes('DROP SCHEMA IF EXISTS "fdw_schema" CASCADE;')));
    assert.ok(plan.downSql.some((s) => s.includes('DROP SERVER IF EXISTS "foreign_server" CASCADE;')));
  });

  it("protects public schema from drop unless explicitly permitted", () => {
    assert.throws(
      () => {
        PublicItem.buildFdwMigrationPlan({
          dropSchemaOnDown: true,
          strict: true,
        });
      },
      {
        message: /Refusing to drop schema 'public'/,
      }
    );

    // Allowing unsafe drop should generate DROP SCHEMA
    const plan = PublicItem.buildFdwMigrationPlan({
      dropSchemaOnDown: true,
      allowUnsafeSchemaDrop: true,
    });
    assert.ok(plan.downSql.some((s) => s.includes('DROP SCHEMA IF EXISTS "public" CASCADE;')));
  });

  it("handles recreateServer option", () => {
    const plan = SampleItem.buildFdwMigrationPlan({
      includeInfrastructure: true,
      recreateServer: true,
    });
    assert.ok(plan.upSql.some((s) => s.includes('DROP SERVER IF EXISTS "foreign_server" CASCADE;')));
  });
});

describe("Error Handling & Concurrency", () => {
  it("rejects sync if server metadata is missing", async () => {
    @Table({ tableName: "unconfigured_items" })
    class UnconfiguredItem extends FDWModel<UnconfiguredItem> {
      @PrimaryKey
      @Column(DataTypes.INTEGER)
      id!: number;
    }

    new Sequelize({ dialect: "postgres", models: [UnconfiguredItem] });

    await assert.rejects(
      async () => {
        await UnconfiguredItem.sync();
      },
      {
        message: /Missing server Metadata for FDW model/,
      }
    );
  });

  it("prevents duplicate server initialization on concurrent calls", async () => {
    let queryCount = 0;
    const mockSequelize = {
      options: {},
      query: async () => {
        queryCount++;
        await new Promise((r) => setTimeout(r, 20));
        return [];
      },
    } as unknown as Sequelize;

    const injector = new FDWInjector(mockSequelize, "error");
    const server = {
      name: "concurrency_db",
      host: "db.com",
      dbName: "concurrent_db",
      dbUser: "usr",
      dbPass: "pwd",
      dbPort: "5432",
    };

    // Run 5 simultaneous init_server calls
    await Promise.all([
      injector.init_server(server),
      injector.init_server(server),
      injector.init_server(server),
      injector.init_server(server),
      injector.init_server(server),
    ]);

    // Query should only have been executed once
    assert.equal(queryCount, 1);
  });
});
