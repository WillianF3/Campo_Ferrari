-- Campo Ferrari V11.2 — coluna de estoque dos acessórios.
-- Faça backup antes de executar. Aplicar UMA vez, somente se faltar a coluna.
-- Preferencialmente use: Painel > Configurações > Manutenção do MySQL.
-- Não remove registros existentes; estoque inicial de acessórios anteriores = 1.
ALTER TABLE `accessories` ADD COLUMN `units_available` INT NOT NULL DEFAULT 1;
