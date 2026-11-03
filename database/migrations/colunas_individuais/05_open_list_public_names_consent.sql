-- Rodar UMA UNICA VEZ apenas se open_list.public_names_consent ainda nao existir.
ALTER TABLE `open_list` ADD COLUMN `public_names_consent` TINYINT(1) NOT NULL DEFAULT 0;
