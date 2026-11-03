-- Opcional: o painel Admin > Configurações > Manutenção também executa esta migração.
-- Fazer backup antes da alteração. Default 1 mantém os vários turnos ativos como antes.
ALTER TABLE `settings`
  ADD COLUMN `allow_multiple_periods` TINYINT(1) NOT NULL DEFAULT 1;
-- Depois, ajuste em Admin > Configurações > Escolha de vários turnos.
