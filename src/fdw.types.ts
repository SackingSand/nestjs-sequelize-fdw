export const log_levels = ["error", "warn", "info", "debug"] as const;

export type LogLevel = (typeof log_levels)[number];

export type FDWServer = {
	name: string;
	host: string;
	dbName: string;
	dbUser: string;
	dbPass: string;
	dbPort: string;
};

export type FDWDecorator = {
	server: FDWServer;
	log_level?: LogLevel;
};