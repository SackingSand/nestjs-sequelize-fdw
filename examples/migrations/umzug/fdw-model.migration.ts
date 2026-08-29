import { QueryInterface } from 'sequelize';
import type { MigrationFn } from 'umzug';
import { RemoteUser } from '../../models/remote-user.model';

type MigrationContext = {
  queryInterface: QueryInterface;
};

export const up: MigrationFn<MigrationContext> = async ({ context }) => {
  const sqlStatements = RemoteUser.buildFdwUpSql({
    includeInfrastructure: true,
    strict: true,
  });

  for (const sql of sqlStatements) {
    await context.queryInterface.sequelize.query(sql, { transaction: null });
  }
};

export const down: MigrationFn<MigrationContext> = async ({ context }) => {
  const sqlStatements = RemoteUser.buildFdwDownSql({
    dropEnumsOnDown: true,
    dropSchemaOnDown: false,
    strict: true,
  });

  for (const sql of sqlStatements) {
    await context.queryInterface.sequelize.query(sql, { transaction: null });
  }
};
