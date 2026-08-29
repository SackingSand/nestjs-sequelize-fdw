import { QueryInterface } from 'sequelize';
import { RemoteUser } from '../../models/remote-user.model';

export async function up(queryInterface: QueryInterface): Promise<void> {
  const sqlStatements = RemoteUser.buildFdwUpSql({
    includeInfrastructure: true,
    strict: true,
  });

  for (const sql of sqlStatements) {
    await queryInterface.sequelize.query(sql, { transaction: null });
  }
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  const sqlStatements = RemoteUser.buildFdwDownSql({
    dropEnumsOnDown: true,
    dropSchemaOnDown: false,
    strict: true,
  });

  for (const sql of sqlStatements) {
    await queryInterface.sequelize.query(sql, { transaction: null });
  }
}
