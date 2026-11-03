-- Campo Ferrari: aprovação e convite de Lista Fechada
-- Faça backup antes de executar. Migração aditiva, sem apagar reservas existentes.

CREATE TABLE IF NOT EXISTS `closed_list_approvals` (
            `reservation_id` VARCHAR(36) NOT NULL PRIMARY KEY,
            `approval_status` VARCHAR(12) NOT NULL DEFAULT 'pending',
            `request_kind` VARCHAR(24) NOT NULL DEFAULT 'lista_fechada',
            `invitation_token` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
            `approval_reason` VARCHAR(1000) NOT NULL DEFAULT '',
            `reviewed_at` DATETIME NULL,
            `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY `uq_closed_invitation` (`invitation_token`),
            KEY `idx_closed_approval` (`approval_status`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `closed_list_participants` (
            `id` VARCHAR(36) NOT NULL PRIMARY KEY,
            `reservation_id` VARCHAR(36) NOT NULL,
            `name` VARCHAR(120) NOT NULL,
            `whatsapp` VARCHAR(20) NOT NULL,
            `privacy_consent` TINYINT(1) NOT NULL DEFAULT 0,
            `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY `uq_closed_participant_phone` (`reservation_id`,`whatsapp`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

