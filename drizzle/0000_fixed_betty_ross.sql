CREATE TABLE `group_members` (
	`group_id` text NOT NULL,
	`member_key` text NOT NULL,
	`member_name` text NOT NULL,
	PRIMARY KEY(`group_id`, `member_key`)
);
--> statement-breakpoint
CREATE INDEX `group_members_member_idx` ON `group_members` (`member_key`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`round` text NOT NULL,
	`book` text NOT NULL,
	`group_no` text NOT NULL,
	`status` text DEFAULT '正常' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `groups_round_idx` ON `groups` (`round`);--> statement-breakpoint
CREATE TABLE `rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`active_count` integer DEFAULT 0 NOT NULL,
	`submitted_count` integer DEFAULT 0 NOT NULL,
	`missing_count` integer DEFAULT 0 NOT NULL,
	`group_count` integer DEFAULT 0 NOT NULL,
	`applied_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `selections` (
	`round` text NOT NULL,
	`member_key` text NOT NULL,
	`member_name` text NOT NULL,
	`feishu_record_id` text,
	`choices_json` text NOT NULL,
	`submitted_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`round`, `member_key`)
);
--> statement-breakpoint
CREATE INDEX `selections_round_idx` ON `selections` (`round`);