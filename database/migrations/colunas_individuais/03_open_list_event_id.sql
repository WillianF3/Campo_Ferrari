-- Rodar UMA UNICA VEZ apenas se open_list.event_id ainda nao existir.
ALTER TABLE `open_list` ADD COLUMN `event_id` VARCHAR(36) NULL DEFAULT NULL;
