CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`google_sub` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`theme` text DEFAULT 'gym-dark' NOT NULL,
	`unit` text DEFAULT 'kg' NOT NULL,
	`timezone` text DEFAULT 'Asia/Tokyo' NOT NULL,
	`target_kcal` integer,
	`target_protein_g` integer,
	`target_fat_g` integer,
	`target_carbs_g` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_sub_unique` ON `users` (`google_sub`);