-- Executar PRIMEIRO na aba SQL do phpMyAdmin, depois de escolher o banco correto.
-- Confere o banco atual sem acessar information_schema e sem modificar dados.
SELECT DATABASE() AS banco_atual;
SHOW TABLES;
SHOW COLUMNS FROM `reservation_players`;
SHOW COLUMNS FROM `open_events`;
SHOW COLUMNS FROM `open_list`;
