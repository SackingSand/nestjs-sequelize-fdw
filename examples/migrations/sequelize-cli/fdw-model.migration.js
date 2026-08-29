"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
const remote_user_model_1 = require("../../models/remote-user.model");
async function up(queryInterface) {
    const sqlStatements = remote_user_model_1.RemoteUser.buildFdwUpSql({
        includeInfrastructure: true,
        strict: true,
    });
    for (const sql of sqlStatements) {
        await queryInterface.sequelize.query(sql, { transaction: null });
    }
}
async function down(queryInterface) {
    const sqlStatements = remote_user_model_1.RemoteUser.buildFdwDownSql({
        dropEnumsOnDown: true,
        dropSchemaOnDown: false,
        strict: true,
    });
    for (const sql of sqlStatements) {
        await queryInterface.sequelize.query(sql, { transaction: null });
    }
}
//# sourceMappingURL=fdw-model.migration.js.map