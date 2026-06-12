CREATE TABLE `exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`name_en` text NOT NULL,
	`name_ja` text,
	`type` text NOT NULL,
	`muscle_group` text NOT NULL,
	`equipment` text NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_exercises_user` ON `exercises` (`user_id`);--> statement-breakpoint
CREATE TABLE `sets` (
	`id` text PRIMARY KEY NOT NULL,
	`workout_exercise_id` text NOT NULL,
	`position` integer NOT NULL,
	`weight_kg` real,
	`reps` integer,
	`rpe` real,
	`duration_sec` integer,
	`distance_m` real,
	FOREIGN KEY (`workout_exercise_id`) REFERENCES `workout_exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sets_workout_exercise` ON `sets` (`workout_exercise_id`);--> statement-breakpoint
CREATE TABLE `template_exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`position` integer NOT NULL,
	`target_sets` integer,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_template_exercises_template` ON `template_exercises` (`template_id`);--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `workout_exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`workout_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`position` integer NOT NULL,
	`notes` text,
	FOREIGN KEY (`workout_id`) REFERENCES `workouts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_workout_exercises_workout` ON `workout_exercises` (`workout_id`);--> statement-breakpoint
CREATE INDEX `idx_workout_exercises_exercise` ON `workout_exercises` (`exercise_id`);--> statement-breakpoint
CREATE TABLE `workouts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`template_id` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`notes` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_workouts_user_started` ON `workouts` (`user_id`,`started_at`);