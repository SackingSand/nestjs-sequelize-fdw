"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
require("reflect-metadata");
const sequelize_1 = require("sequelize");
const sequelize_typescript_1 = require("sequelize-typescript");
const src_1 = require("../src");
(0, node_test_1.describe)("SQL Safety & Escaping Utilities", () => {
    (0, node_test_1.it)("quotes standard identifiers and escapes embedded quotes", () => {
        strict_1.default.equal((0, src_1.quoteIdentifier)("users"), '"users"');
        strict_1.default.equal((0, src_1.quoteIdentifier)('user"table'), '"user""table"');
        strict_1.default.equal((0, src_1.quoteIdentifier)("schema-with-dash"), '"schema-with-dash"');
    });
    (0, node_test_1.it)("escapes single quotes in string literals", () => {
        strict_1.default.equal((0, src_1.escapeLiteral)("hello"), "'hello'");
        strict_1.default.equal((0, src_1.escapeLiteral)("p'a$sw0rd'"), "'p''a$sw0rd'''");
        strict_1.default.equal((0, src_1.escapeLiteral)("5432"), "'5432'");
    });
});
(0, node_test_1.describe)("DDL SQL Generation", () => {
    (0, node_test_1.it)("generates correct extension initialization SQL", () => {
        strict_1.default.equal((0, src_1.buildInitFdwSql)(), "CREATE EXTENSION IF NOT EXISTS postgres_fdw;");
    });
    (0, node_test_1.it)("generates server init SQL with properly escaped credentials", () => {
        const server = {
            name: 'remote_db"test',
            host: "db.example.com",
            dbName: "remote_db",
            dbUser: "admin'user",
            dbPass: "s3cr'et",
            dbPort: "5432",
        };
        const sql = (0, src_1.buildInitServerSql)(server, false);
        strict_1.default.ok(sql.includes('CREATE SERVER "remote_db""test"'));
        strict_1.default.ok(sql.includes("OPTIONS (user 'admin''user', password 's3cr''et')"));
        strict_1.default.ok(sql.includes("WHERE srvname = 'remote_db\"test'"));
        const recreateSql = (0, src_1.buildInitServerSql)(server, true);
        strict_1.default.ok(recreateSql.includes('DROP SERVER IF EXISTS "remote_db""test" CASCADE;'));
    });
    (0, node_test_1.it)("builds foreign table DDL with correct schema and types", () => {
        const builder = new src_1.ForeignTableQueryBuilder("orders", "remote_server", "remote_schema", "local_schema");
        builder.addField({ name: "id", type: "uuid" });
        builder.addField({ name: "total_amount", type: "numeric(10,2)" });
        const sql = builder.build();
        strict_1.default.ok(sql.includes('CREATE FOREIGN TABLE "local_schema"."orders"'));
        strict_1.default.ok(sql.includes('"id" uuid'));
        strict_1.default.ok(sql.includes('"total_amount" numeric(10,2)'));
        strict_1.default.ok(sql.includes('SERVER "remote_server"'));
        strict_1.default.ok(sql.includes("OPTIONS (schema_name 'remote_schema', table_name 'orders')"));
    });
});
(0, node_test_1.describe)("Data Type Mapping", () => {
    (0, node_test_1.it)("maps primitive and advanced types correctly", () => {
        strict_1.default.equal((0, src_1.sequelizeTypeToPostgres)(sequelize_1.DataTypes.UUID), "uuid");
        strict_1.default.equal((0, src_1.sequelizeTypeToPostgres)(sequelize_1.DataTypes.STRING), "text");
        strict_1.default.equal((0, src_1.sequelizeTypeToPostgres)(sequelize_1.DataTypes.TEXT), "text");
        strict_1.default.equal((0, src_1.sequelizeTypeToPostgres)(sequelize_1.DataTypes.INTEGER), "integer");
        strict_1.default.equal((0, src_1.sequelizeTypeToPostgres)(sequelize_1.DataTypes.BIGINT), "bigint");
        strict_1.default.equal((0, src_1.sequelizeTypeToPostgres)(sequelize_1.DataTypes.SMALLINT), "smallint");
        strict_1.default.equal((0, src_1.sequelizeTypeToPostgres)(sequelize_1.DataTypes.BOOLEAN), "boolean");
        strict_1.default.equal((0, src_1.sequelizeTypeToPostgres)(sequelize_1.DataTypes.DATE), "timestamp");
        strict_1.default.equal((0, src_1.sequelizeTypeToPostgres)(sequelize_1.DataTypes.DATEONLY), "date");
        strict_1.default.equal((0, src_1.sequelizeTypeToPostgres)(sequelize_1.DataTypes.TIME), "time");
        strict_1.default.equal((0, src_1.sequelizeTypeToPostgres)(sequelize_1.DataTypes.DOUBLE), "double precision");
        strict_1.default.equal((0, src_1.sequelizeTypeToPostgres)(sequelize_1.DataTypes.REAL), "real");
        strict_1.default.equal((0, src_1.sequelizeTypeToPostgres)(sequelize_1.DataTypes.BLOB), "bytea");
        strict_1.default.equal((0, src_1.sequelizeTypeToPostgres)(sequelize_1.DataTypes.INET), "inet");
        strict_1.default.equal((0, src_1.sequelizeTypeToPostgres)(sequelize_1.DataTypes.CITEXT), "citext");
        strict_1.default.equal((0, src_1.sequelizeTypeToPostgres)(sequelize_1.DataTypes.MACADDR), "macaddr");
        strict_1.default.equal((0, src_1.sequelizeTypeToPostgres)(sequelize_1.DataTypes.JSON), "json");
        strict_1.default.equal((0, src_1.sequelizeTypeToPostgres)(sequelize_1.DataTypes.JSONB), "jsonb");
    });
    (0, node_test_1.it)("handles decimal with precision and scale", () => {
        strict_1.default.equal((0, src_1.sequelizeTypeToPostgres)(sequelize_1.DataTypes.DECIMAL(12, 4)), "numeric(12,4)");
        strict_1.default.equal((0, src_1.sequelizeTypeToPostgres)(sequelize_1.DataTypes.DECIMAL(8)), "numeric(8)");
        strict_1.default.equal((0, src_1.sequelizeTypeToPostgres)(sequelize_1.DataTypes.DECIMAL), "numeric");
    });
    (0, node_test_1.it)("handles CHAR with length", () => {
        strict_1.default.equal((0, src_1.sequelizeTypeToPostgres)(sequelize_1.DataTypes.CHAR(10)), "char(10)");
        strict_1.default.equal((0, src_1.sequelizeTypeToPostgres)(sequelize_1.DataTypes.CHAR), "char");
    });
    (0, node_test_1.it)("handles ARRAY types", () => {
        strict_1.default.equal((0, src_1.sequelizeTypeToPostgres)(sequelize_1.DataTypes.ARRAY(sequelize_1.DataTypes.INTEGER)), "integer[]");
        strict_1.default.equal((0, src_1.sequelizeTypeToPostgres)(sequelize_1.DataTypes.ARRAY(sequelize_1.DataTypes.UUID)), "uuid[]");
    });
    (0, node_test_1.it)("handles ENUM with sanitized snake_case name without leading underscores", () => {
        const enumInfo = (0, src_1.sequelizeTypeToPostgres)(sequelize_1.DataTypes.ENUM("pending", "approved"), "PaymentStatus", "payments", "custom_schema");
        strict_1.default.equal(typeof enumInfo, "object");
        if (typeof enumInfo === "object" && enumInfo.isEnum) {
            strict_1.default.equal(enumInfo.schema, "custom_schema");
            strict_1.default.equal(enumInfo.enumName, "enum_payments_payment_status");
            strict_1.default.equal(enumInfo.typeName, '"custom_schema"."enum_payments_payment_status"');
            strict_1.default.deepEqual(enumInfo.values, ["pending", "approved"]);
            const enumSql = (0, src_1.buildEnumTypeSql)(enumInfo);
            strict_1.default.ok(enumSql.includes("CREATE TYPE \"custom_schema\".\"enum_payments_payment_status\" AS ENUM ('pending', 'approved')"));
        }
    });
});
(0, node_test_1.describe)("Migration Plan Generation", () => {
    let SampleItem = class SampleItem extends src_1.FDWModel {
    };
    __decorate([
        (0, sequelize_typescript_1.Column)(sequelize_1.DataTypes.UUID),
        __metadata("design:type", String)
    ], SampleItem.prototype, "id", void 0);
    __decorate([
        (0, sequelize_typescript_1.Column)(sequelize_1.DataTypes.STRING),
        __metadata("design:type", String)
    ], SampleItem.prototype, "name", void 0);
    __decorate([
        (0, sequelize_typescript_1.Column)(sequelize_1.DataTypes.ENUM("a", "b")),
        __metadata("design:type", String)
    ], SampleItem.prototype, "category", void 0);
    SampleItem = __decorate([
        (0, src_1.FDWMetadata)({
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
        }),
        (0, sequelize_typescript_1.Table)({
            tableName: "sample_items",
            schema: "fdw_schema",
        })
    ], SampleItem);
    (0, node_test_1.it)("generates complete up and down migration plans", () => {
        const plan = SampleItem.buildFdwMigrationPlan({
            includeInfrastructure: true,
            dropEnumsOnDown: true,
            dropSchemaOnDown: true,
            dropServerOnDown: true,
            strict: true,
        });
        strict_1.default.ok(plan.upSql.some((s) => s.includes("CREATE EXTENSION IF NOT EXISTS postgres_fdw;")));
        strict_1.default.ok(plan.upSql.some((s) => s.includes('CREATE SCHEMA IF NOT EXISTS "fdw_schema";')));
        strict_1.default.ok(plan.upSql.some((s) => s.includes('CREATE FOREIGN TABLE "fdw_schema"."sample_items"')));
        strict_1.default.ok(plan.downSql.some((s) => s.includes('DROP FOREIGN TABLE IF EXISTS "fdw_schema"."sample_items";')));
        strict_1.default.ok(plan.downSql.some((s) => s.includes('DROP TYPE IF EXISTS "fdw_schema"."enum_sample_items_category" CASCADE;')));
        strict_1.default.ok(plan.downSql.some((s) => s.includes('DROP SCHEMA IF EXISTS "fdw_schema" CASCADE;')));
        strict_1.default.ok(plan.downSql.some((s) => s.includes('DROP SERVER IF EXISTS "foreign_server" CASCADE;')));
    });
    (0, node_test_1.it)("protects public schema from drop unless explicitly permitted", () => {
        let PublicItem = class PublicItem extends src_1.FDWModel {
        };
        __decorate([
            (0, sequelize_typescript_1.Column)(sequelize_1.DataTypes.UUID),
            __metadata("design:type", String)
        ], PublicItem.prototype, "id", void 0);
        PublicItem = __decorate([
            (0, src_1.FDWMetadata)({
                server: {
                    name: "foreign_server",
                    host: "remote.host",
                    dbName: "remote_db",
                    dbUser: "user",
                    dbPass: "pass",
                    dbPort: "5432",
                },
                local_schema: "public",
            }),
            (0, sequelize_typescript_1.Table)({
                tableName: "public_items",
                schema: "public",
            })
        ], PublicItem);
        strict_1.default.throws(() => {
            PublicItem.buildFdwMigrationPlan({
                dropSchemaOnDown: true,
                strict: true,
            });
        }, {
            message: /Refusing to drop schema 'public'/,
        });
    });
});
//# sourceMappingURL=fdw.spec.js.map