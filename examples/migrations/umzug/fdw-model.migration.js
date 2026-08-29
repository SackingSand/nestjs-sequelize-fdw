"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.down = exports.up = void 0;
const remote_user_model_1 = require("../../models/remote-user.model");
const up = async ({ context }) => {
    const sqlStatements = remote_user_model_1.RemoteUser.buildFdwUpSql({
        includeInfrastructure: true,
        strict: true,
    });
    for (const sql of sqlStatements) {
        await context.queryInterface.sequelize.query(sql, { transaction: null });
    }
};
exports.up = up;
const down = async ({ context }) => {
    const sqlStatements = remote_user_model_1.RemoteUser.buildFdwDownSql({
        dropEnumsOnDown: true,
        dropSchemaOnDown: false,
        strict: true,
    });
    for (const sql of sqlStatements) {
        await context.queryInterface.sequelize.query(sql, { transaction: null });
    }
};
exports.down = down;
//# sourceMappingURL=fdw-model.migration.js.map