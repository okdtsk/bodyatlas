CREATE TABLE `ai_settings` (
	`user_id` text PRIMARY KEY NOT NULL REFERENCES `users`(`id`),
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`encrypted_key` text NOT NULL,
	`key_iv` text NOT NULL,
	`last_review` text,
	`last_review_at` integer,
	`updated_at` integer NOT NULL
);
