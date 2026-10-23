-- Rodar UMA UNICA VEZ apenas se reservation_players.player_name ainda nao existir.
ALTER TABLE `reservation_players` ADD COLUMN `player_name` VARCHAR(120) NOT NULL DEFAULT '';
