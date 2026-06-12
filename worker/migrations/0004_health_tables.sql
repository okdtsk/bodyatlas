CREATE TABLE `body_measurements` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`measured_at` integer NOT NULL,
	`weight_kg` real,
	`body_fat_pct` real,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_measurements_user_measured` ON `body_measurements` (`user_id`,`measured_at`);--> statement-breakpoint
CREATE TABLE `meals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`eaten_at` integer NOT NULL,
	`name` text NOT NULL,
	`calories` integer,
	`protein_g` real,
	`fat_g` real,
	`carbs_g` real,
	`notes` text,
	`is_favorite` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_meals_user_eaten` ON `meals` (`user_id`,`eaten_at`);--> statement-breakpoint
CREATE TABLE `sleep_records` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`bed_at` integer NOT NULL,
	`woke_at` integer NOT NULL,
	`quality` integer,
	`notes` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sleep_user_woke` ON `sleep_records` (`user_id`,`woke_at`);