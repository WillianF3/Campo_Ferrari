-- Rodar UMA UNICA VEZ apenas se open_events.period ainda nao existir.
ALTER TABLE `open_events` ADD COLUMN `period` VARCHAR(12) NULL DEFAULT NULL;
