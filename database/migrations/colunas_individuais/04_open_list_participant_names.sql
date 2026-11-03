-- Rodar UMA UNICA VEZ apenas se open_list.participant_names ainda nao existir.
ALTER TABLE `open_list` ADD COLUMN `participant_names` LONGTEXT NULL;
