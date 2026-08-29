import { QueryInterface } from 'sequelize';
import type { MigrationFn } from 'umzug';
type MigrationContext = {
    queryInterface: QueryInterface;
};
export declare const up: MigrationFn<MigrationContext>;
export declare const down: MigrationFn<MigrationContext>;
export {};
