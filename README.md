# sequelize-fdw

Plug and Play Sequelize model for PostgreSQL Foreign Data Wrapper (FDW). Seamlessly integrate FDW tables into your Sequelize application with automatic enum type creation and concurrency-safe server initialization.

## Features

- 🔌 **Plug & Play**: Decorator-based FDW table setup
- 📦 **Auto Enum Handling**: Automatically creates PostgreSQL ENUM types before table creation
- 🔒 **Concurrency Safe**: Prevents duplicate server initialization under concurrent model syncs
- 📝 **Configurable Logging**: Level-aware logging (error, warn, info, debug) with info as default
- 🛡️ **TypeScript First**: Full type safety for all APIs

## Installation

```bash
npm install sequelize-fdw sequelize sequelize-typescript
```

## Quick Start

### 1. Create an FDW Model

```typescript
import { DataTypes } from 'sequelize';
import { Column, Model, Table } from 'sequelize-typescript';
import { FDWModel, FDWMetadata } from 'sequelize-fdw';

@FDWMetadata({
  server: {
    name: 'foreign_db',
    host: 'remote.example.com',
    dbName: 'remote_database',
    dbUser: 'remote_user',
    dbPass: 'remote_password',
    dbPort: '5432',
  },
  foreign_schema: 'remote_schema', // optional, defaults to 'public'
  local_schema: 'fdw_local', // optional, defaults to model schema or 'public'
  log_level: 'error', // optional, defaults to 'error'
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
```

### 2. Register with Sequelize

```typescript
import 'reflect-metadata';
import { Sequelize } from 'sequelize-typescript';
import { RemoteUser } from './models/remote-user.model';

const sequelize = new Sequelize({
  dialect: 'postgres',
  host: 'localhost',
  port: 5432,
  username: 'postgres',
  password: 'password',
  database: 'local_db',
  models: [RemoteUser],
})

// Required once at startup: triggers FDW extension/server/table initialization
await RemoteUser.sync();
```

### Precaution: sync() is required

This package depends on model `sync()` to initialize FDW extension/server/table objects.

Choose one of these approaches:

1. Call `await sequelize.sync()` during startup.
2. Or call `await YourFdwModel.sync()` manually once during startup.

If neither is done, FDW objects will not be created and your foreign-table queries can fail.

### 3. Use the Model

```typescript
import express from 'express';
import { RemoteUser } from './models/remote-user.model';

const app = express();

app.get('/users', async (_req, res) => {
  const users = await RemoteUser.findAll();
  res.json(users);
});

app.get('/users/:email', async (req, res) => {
  const user = await RemoteUser.findOne({ where: { email: req.params.email } });
  res.json(user);
});
```

### 4. Define Model Relations

You can define relationships between FDW models and other Sequelize models:

```typescript
import { BelongsTo, ForeignKey, HasMany } from 'sequelize-typescript';
import { FDWModel, FDWMetadata } from 'sequelize-fdw';

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
})
@Table({
  tableName: 'remote_posts',
  schema: 'fdw_local',
})
export class RemotePost extends FDWModel<RemotePost> {
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
  schema: 'fdw_local',
})
export class RemoteUser extends FDWModel<RemoteUser> {
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
  return RemoteUser.findOne({
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
  foreign_schema?: string,
  local_schema?: string,
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
- `foreign_schema` (optional): Remote schema that contains the source table (defaults to `"public"`)
- `local_schema` (optional): Local PostgreSQL schema where the foreign table is created
  - Defaults to the model `@Table({ schema })` value when present, otherwise `"public"`
- `log_level` (optional): Logging level - `"error" | "warn" | "info" | "debug"` (defaults to `"error"`)

### FDWModel

Extend this class for your FDW models. Provides automatic FDW table creation via the `sync()` method.

```typescript
export class RemoteUser extends FDWModel<RemoteUser> {
  // your columns...
}
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
  <img style="border-radius: 50%;" src="https://github.com/sackingsand.png?size=72" width="72" height="72" alt="sackingsand" />
</a>

## Contributors

<a href="https://github.com/Ikhraaazh">
  <img style="border-radius: 50%;" src="https://github.com/Ikhraaazh.png?size=72" width="72" height="72" alt="Ikhraaazh" />
</a>

