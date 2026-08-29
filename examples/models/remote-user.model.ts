import { DataTypes } from 'sequelize';
import { Column, Table } from 'sequelize-typescript';
import { FDWModel, FDWMetadata } from '../../src';

@FDWMetadata({
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
})
@Table({
  tableName: 'remote_users',
  schema: 'fdw_local',
})
export class RemoteUser extends FDWModel<RemoteUser> {
  @Column(DataTypes.UUID)
  id!: string;

  @Column(DataTypes.STRING)
  email!: string;

  @Column(DataTypes.ENUM('active', 'inactive'))
  status!: 'active' | 'inactive';
}
