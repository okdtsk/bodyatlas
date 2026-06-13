ALTER TABLE `sets` ADD COLUMN `client_id` text;
ALTER TABLE `meals` ADD COLUMN `client_id` text;
ALTER TABLE `sleep_records` ADD COLUMN `client_id` text;
ALTER TABLE `body_measurements` ADD COLUMN `client_id` text;
CREATE UNIQUE INDEX `idx_sets_client_id` ON `sets` (`client_id`);
CREATE UNIQUE INDEX `idx_meals_client_id` ON `meals` (`client_id`);
CREATE UNIQUE INDEX `idx_sleep_client_id` ON `sleep_records` (`client_id`);
CREATE UNIQUE INDEX `idx_measurements_client_id` ON `body_measurements` (`client_id`);
