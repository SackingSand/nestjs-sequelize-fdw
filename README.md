# nestjs-sequelize-fdw

Plug and Play Sequelize model for PostgreSQL Foreign Data Wrapper (FDW). Seamlessly integrate FDW tables into your NestJS + Sequelize application with automatic enum type creation and concurrency-safe server initialization.

## Features

- 🔌 **Plug & Play**: Decorator-based FDW table setup
- 📦 **Auto Enum Handling**: Automatically creates PostgreSQL ENUM types before table creation
- 🔒 **Concurrency Safe**: Prevents duplicate server initialization under concurrent model syncs
- 📝 **Configurable Logging**: Level-aware logging (error, warn, info, debug) with info as default
- 🛡️ **TypeScript First**: Full type safety for all APIs

## Installation

```bash
npm install nestjs-sequelize-fdw sequelize sequelize-typescript
```

## Quick Start

### 1. Create an FDW Model

```typescript
import { DataTypes } from 'sequelize';
import { Column, Model, Table } from 'sequelize-typescript';
import { BaseFDWModel, FDWMetadata } from 'nestjs-sequelize-fdw';

@FDWMetadata({
  server: {
    name: 'foreign_db',
    host: 'remote.example.com',
    dbName: 'remote_database',
    dbUser: 'remote_user',
    dbPass: 'remote_password',
    dbPort: '5432',
  },
  log_level: 'error', // optional, defaults to 'error'
})
@Table({
  tableName: 'remote_users',
  schema: 'public',
})
export class RemoteUser extends BaseFDWModel<RemoteUser> {
  @Column(DataTypes.UUID)
  id!: string;

  @Column(DataTypes.STRING)
  email!: string;

  @Column(DataTypes.ENUM('active', 'inactive'))
  status!: 'active' | 'inactive';
}
```

### 2. Register with Sequelize

```typescript
import { SequelizeModule } from '@nestjs/sequelize';
import { RemoteUser } from './models/remote-user.model';

@Module({
  imports: [
    SequelizeModule.forRoot({
      dialect: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: 'password',
      database: 'local_db',
      models: [RemoteUser],
      autoLoadModels: true,
      synchronize: true,
    }),
  ],
})
export class DatabaseModule {}
```

### 3. Use the Model

```typescript
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { RemoteUser } from './models/remote-user.model';

@Injectable()
export class UserService {
  constructor(
    @InjectModel(RemoteUser) private remoteUserModel: typeof RemoteUser,
  ) {}

  async getRemoteUsers() {
    return this.remoteUserModel.findAll();
  }

  async getUserByEmail(email: string) {
    return this.remoteUserModel.findOne({ where: { email } });
  }
}
```

### 4. Define Model Relations

You can define relationships between FDW models and other Sequelize models:

```typescript
import { BelongsTo, ForeignKey, HasMany } from 'sequelize-typescript';
import { BaseFDWModel, FDWMetadata } from 'nestjs-sequelize-fdw';

@FDWMetadata({
  server: {
    name: 'foreign_db',
    host: 'remote.example.com',
    dbName: 'remote_database',
    dbUser: 'remote_user',
    dbPass: 'remote_password',
    dbPort: '5432',
  },
})
@Table({
  tableName: 'remote_posts',
  schema: 'public',
})
export class RemotePost extends BaseFDWModel<RemotePost> {
  @Column(DataTypes.UUID)
  id!: string;

  @ForeignKey(() => RemoteUser)
  @Column(DataTypes.UUID)
  authorId!: string;

  @Column(DataTypes.STRING)
  title!: string;

  @BelongsTo(() => RemoteUser)
  author?: RemoteUser;
}

// Update RemoteUser to include the relationship
@Table({
  tableName: 'remote_users',
  schema: 'public',
})
export class RemoteUser extends BaseFDWModel<RemoteUser> {
  @Column(DataTypes.UUID)
  id!: string;

  @Column(DataTypes.STRING)
  email!: string;

  @HasMany(() => RemotePost, 'authorId')
  posts?: RemotePost[];
}
```

Now use relations in your service:

```typescript
async getUserWithPosts(userId: string) {
  return this.remoteUserModel.findOne({
    where: { id: userId },
    include: [RemotePost],
  });
}
```

## API Reference

### FDWMetadata Decorator

Decorate your model class with FDW configuration.

```typescript
@FDWMetadata({
  server: FDWServer,
  log_level?: LogLevel,
})
```

**Options:**

- `server` (required): FDW server configuration
  - `name`: Server identifier (must be unique)
  - `host`: Remote database hostname
  - `dbName`: Remote database name
  - `dbUser`: Remote database user
  - `dbPass`: Remote database password
  - `dbPort`: Remote database port (string)
- `log_level` (optional): Logging level - `"error" | "warn" | "info" | "debug"` (defaults to `"error"`)

### BaseFDWModel

Extend this class for your FDW models. Provides automatic FDW table creation via the `sync()` method.

```typescript
export class RemoteUser extends BaseFDWModel<RemoteUser> {
  // your columns...
}
```

### Logging

Import and create a logger for your own use:

```typescript
import { createFdwLogger } from 'nestjs-sequelize-fdw';

const logger = createFdwLogger('MyModule', 'debug');
logger.error('Error message');
logger.warn('Warning message');
logger.info('Info message');
logger.debug('Debug message');
```

## Supported Column Types

The package automatically maps Sequelize types to PostgreSQL FDW types:

| Sequelize | PostgreSQL |
| --------- | ---------- |
| `UUID` | `uuid` |
| `STRING` | `text` |
| `TEXT` | `text` |
| `INTEGER` | `integer` |
| `DECIMAL` | `numeric(10,2)` |
| `DOUBLE` | `double precision` |
| `BOOLEAN` | `boolean` |
| `DATE` / `DATEONLY` | `timestamp` / `date` |
| `JSON` / `JSONB` | `json` / `jsonb` |
| `ENUM` | *(auto-created PostgreSQL ENUM type)* |
| `ARRAY` | *(with element type suffix `[]`)* |

## Under the Hood

1. **Enum Creation**: Before creating the FDW table, all ENUM columns trigger automatic PostgreSQL ENUM type creation.
2. **Server Initialization**: FDW servers are created once per Sequelize instance, even with concurrent model syncs.
3. **Deduplication**: Uses an in-memory Set + Promise map to prevent duplicate initialization.
4. **Idempotent Sync**: Multiple calls to model.sync() are safe—servers and tables only create if missing.

## Advanced: Custom Logging

Pass a log level when using models:

```typescript
@FDWMetadata({
  server: { /* ... */ },
  log_level: 'debug', // verbose logging
})
```

Available levels:
- `error` - Only errors *(default)*
- `warn` - Errors + warnings
- `info` - Errors, warnings, info
- `debug` - All messages

## License

ISC

## Contributing

Contributions are welcome! Please fork and submit a pull request.

## Author

<a href="https://github.com/sackingsand">
  <img src="https://github.com/sackingsand.png?size=72" width="72" height="72" alt="sackingsand" />
</a>

**sackingsand** — [GitHub](https://github.com/sackingsand)

## Contributors

<a href="https://github.com/Ikhraaazh">
  <img src="https://github.com/Ikhraaazh.png?size=72" width="72" height="72" alt="Ikhraaazh" />
</a>

- **Ikhraaazh** — [GitHub](https://github.com/Ikhraaazh), ikhsanrafi06@gmail.com
