-- CAMPO FERRARI V9 | HOSTINGER | 23/10/2026
-- IMPORTANTE: esta e uma opcao MANUAL. Prefira o botao seguro dentro de
-- /admin/ -> Configuracoes -> Manutencao MySQL (adiciona somente colunas faltantes).
--
-- 1. FACA BACKUP do banco antes de tudo.
-- 2. No phpMyAdmin CLIQUE NO BANCO usado em api/config.local.php.
-- 3. Primeiro execute APENAS as consultas abaixo, para CONFERIR as colunas.
-- 4. Depois execute INDIVIDUALMENTE apenas os ALTER TABLE que precisarem.
--    Se alguma coluna ja existir, NAO execute novamente seu ALTER TABLE.
-- 5. Se receber erro de permissão ALTER TABLE, solicite essa permissao ao host.
--
-- Evita SELECT information_schema e PREPARE que causaram o erro #1044.
-- Nao ha DELETE, DROP, TRUNCATE, UPDATE ou mudanca em dados existentes.

SELECT DATABASE() AS banco_atual;
SHOW TABLES;
SHOW COLUMNS FROM `reservation_players`;
SHOW COLUMNS FROM `open_events`;
SHOW COLUMNS FROM `open_list`;

-- Este script faz SOMENTE A VERIFICACAO (nao altera banco).
-- PARA APLICAR, use a opcao segura em Admin > Configuracoes > Manutencao MySQL.
-- ALTERNATIVA: em colunas_individuais/, execute os scripts .sql separados,
-- SOMENTE para as colunas que faltam, no banco correto.
-- Nao execute uma alteracao duas vezes.
