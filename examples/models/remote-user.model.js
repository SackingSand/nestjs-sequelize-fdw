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
Object.defineProperty(exports, "__esModule", { value: true });
exports.RemoteUser = void 0;
const sequelize_1 = require("sequelize");
const sequelize_typescript_1 = require("sequelize-typescript");
const src_1 = require("../../src");
let RemoteUser = class RemoteUser extends src_1.FDWModel {
};
exports.RemoteUser = RemoteUser;
__decorate([
    (0, sequelize_typescript_1.Column)(sequelize_1.DataTypes.UUID),
    __metadata("design:type", String)
], RemoteUser.prototype, "id", void 0);
__decorate([
    (0, sequelize_typescript_1.Column)(sequelize_1.DataTypes.STRING),
    __metadata("design:type", String)
], RemoteUser.prototype, "email", void 0);
__decorate([
    (0, sequelize_typescript_1.Column)(sequelize_1.DataTypes.ENUM('active', 'inactive')),
    __metadata("design:type", String)
], RemoteUser.prototype, "status", void 0);
exports.RemoteUser = RemoteUser = __decorate([
    (0, src_1.FDWMetadata)({
        server: {
            name: 'foreign_db',
            host: 'remote.example.com',
            dbName: 'remote_database',
            dbUser: 'remote_user',
            dbPass: 'remote_password',
            dbPort: '5432',
        },
        foreign_schema: 'remote_schema',
        local_schema: 'fdw_local',
        log_level: 'error',
    }),
    (0, sequelize_typescript_1.Table)({
        tableName: 'remote_users',
        schema: 'fdw_local',
    })
], RemoteUser);
//# sourceMappingURL=remote-user.model.js.map