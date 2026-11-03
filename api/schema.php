<?php
declare(strict_types=1);
/**
 * Colunas usadas pelas duas modalidades de lista.
 * Nao consulta information_schema (algumas hospedagens compartilhadas o bloqueiam).
 * Nomes de tabelas e colunas sao constantes, nao entradas do navegador.
 */
function schema_definitions(): array {
    return [
        'closed_list_approvals' => ['request_kind' => "VARCHAR(24) NOT NULL DEFAULT 'lista_fechada'"],
        'closed_list_participants' => [
            'public_name_consent' => 'TINYINT(1) NOT NULL DEFAULT 0',
            'public_full_name_consent' => 'TINYINT(1) NOT NULL DEFAULT 0',
            'edit_token_hash' => 'CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL DEFAULT NULL',
        ],
        'settings' => [
            'allow_multiple_periods' => 'TINYINT(1) NOT NULL DEFAULT 1',
            'allow_multiple_periods_closed' => 'TINYINT(1) NOT NULL DEFAULT 1',
            'allow_multiple_periods_private' => 'TINYINT(1) NOT NULL DEFAULT 1',
            'notification_email_enabled' => 'TINYINT(1) NOT NULL DEFAULT 0',
            'notification_whatsapp_enabled' => 'TINYINT(1) NOT NULL DEFAULT 0',
            'notification_email_to' => "VARCHAR(190) NOT NULL DEFAULT ''",
            'notification_whatsapp_to' => "VARCHAR(20) NOT NULL DEFAULT ''",
        ],
        'accessories' => [
            'units_available' => 'INT NOT NULL DEFAULT 1',
        ],
        // Equipment/accessories já possuem sort_order na V12.15.
        // A coluna faltante de munição é criada uma única vez, pelo painel autenticado.
        'ammo' => [
            'sort_order' => 'INT NOT NULL DEFAULT 0',
        ],
        'reservation_players' => [
            'player_name' => "VARCHAR(120) NOT NULL DEFAULT ''",
        ],
        'open_events' => [
            'period' => 'VARCHAR(12) NULL DEFAULT NULL',
        ],
        'open_list' => [
            'event_id' => 'VARCHAR(36) NULL DEFAULT NULL',
            'participant_names' => 'LONGTEXT NULL',
            'public_names_consent' => 'TINYINT(1) NOT NULL DEFAULT 0',
        ],
    ];
}

/** Checa a tabela adicional com cache por requisição, sem exigir permissões de information_schema. */
function reservation_periods_ready(bool $refresh=false): bool {
    static $ready = null;
    if($refresh || $ready===null) {
        $stmt=db()->query("SHOW TABLES LIKE 'reservation_periods'");
        $ready=(bool)$stmt->fetchColumn();
    }
    return $ready;
}

/** SHOW COLUMNS respeita as permissoes normais sobre a propria tabela. */
function schema_table_columns(string $table): array {
    if(!array_key_exists($table,schema_definitions()))
        throw new InvalidArgumentException('Tabela fora da lista permitida.');
    $fields=db()->query('SHOW COLUMNS FROM `'.$table.'`')->fetchAll(PDO::FETCH_COLUMN,0);
    return array_fill_keys($fields,true);
}

function column_exists(string $table,string $column): bool {
    if(!array_key_exists($column,schema_definitions()[$table]??[]))
        throw new InvalidArgumentException('Coluna fora da lista permitida.');
    return isset(schema_table_columns($table)[$column]);
}

/** Devolve os identificadores estaveis, ex.: open_list.participant_names. */
function schema_missing_columns(): array {
    $missing=[];
    if(!reservation_periods_ready(true))$missing[]='reservation_periods (tabela)';
    foreach(schema_definitions() as $table=>$definitions){
        if(in_array($table,['closed_list_approvals','closed_list_participants'],true)
            && !db()->query("SHOW TABLES LIKE '".$table."'")->fetchColumn())continue;
        $present=schema_table_columns($table);
        foreach($definitions as $column=>$type){
            if(!isset($present[$column]))$missing[]=$table.'.'.$column;
        }
    }
    foreach(['admin_push_subscriptions','push_vapid_keys','closed_list_approvals','closed_list_participants'] as $table){
        if(!db()->query("SHOW TABLES LIKE '".$table."'")->fetchColumn())$missing[]=$table.' (tabela)';
    }
    return $missing;
}

/**
 * Executar somente por POST /api/admin/schema/migrate com login, CSRF e backup.
 * DDL no MySQL possui commit implicito; nunca promete rollback de alteracoes.
 * O bloqueio protege contra dois admins acionando a migracao ao mesmo tempo.
 */
function schema_apply_migration(): array {
    $pdo=db();
    $locked=(int)$pdo->query("SELECT GET_LOCK('cf_schema_v9_names', 10)")->fetchColumn();
    if($locked!==1)fail(409,'Ja existe uma atualizacao do banco em andamento.');
    try {
        $changes=[];
        foreach(closed_list_table_definitions() as $table=>$ddl){
            if(!$pdo->query("SHOW TABLES LIKE '".$table."'")->fetchColumn()){
                $pdo->exec($ddl);
                $changes[]=$table.' (tabela)';
            }
        }
        closed_lists_ready(true);
        if(!reservation_periods_ready(true)) {
            $pdo->exec("CREATE TABLE IF NOT EXISTS `reservation_periods` (
                `reservation_id` VARCHAR(36) NOT NULL,
                `period` VARCHAR(12) NOT NULL,
                PRIMARY KEY (`reservation_id`, `period`),
                KEY `idx_period` (`period`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
            $changes[]='reservation_periods (tabela)';
            reservation_periods_ready(true);
        }
        // Web Push V12.18: chaves privadas VAPID e assinaturas de dispositivos logados.
        // Apenas a manutenção autorizada pode criar as tabelas.
        if(!db()->query("SHOW TABLES LIKE 'push_vapid_keys'")->fetchColumn()){
            $pdo->exec("CREATE TABLE IF NOT EXISTS `push_vapid_keys` (
                `id` TINYINT UNSIGNED NOT NULL PRIMARY KEY,
                `public_key` VARCHAR(100) NOT NULL,
                `private_pem` TEXT NOT NULL,
                `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
            $changes[]='push_vapid_keys (tabela)';
        }
        if(!db()->query("SHOW TABLES LIKE 'admin_push_subscriptions'")->fetchColumn()){
            $pdo->exec("CREATE TABLE IF NOT EXISTS `admin_push_subscriptions` (
                `id` CHAR(64) NOT NULL PRIMARY KEY,
                `admin_id` VARCHAR(64) NOT NULL,
                `endpoint` TEXT NOT NULL,
                `p256dh` VARCHAR(100) NOT NULL,
                `auth` VARCHAR(64) NOT NULL,
                `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX `idx_admin_updated` (`admin_id`, `updated_at`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
            $changes[]='admin_push_subscriptions (tabela)';
        }
        foreach(schema_definitions() as $table=>$definitions){
            $existing=schema_table_columns($table);
            foreach($definitions as $column=>$type){
                if(isset($existing[$column]))continue;
                try {
                    $pdo->exec('ALTER TABLE `'.$table.'` ADD COLUMN `'.$column.'` '.$type);
                    $changes[]=$table.'.'.$column;
                    // Migracao sem surpresa: cada nova opcao herda o estado da
                    // preferencia antiga somente no momento em que a coluna nasce.
                    if($table==='settings' && in_array($column,['allow_multiple_periods_closed','allow_multiple_periods_private'],true)){
                        $pdo->exec('UPDATE `settings` SET `'.$column.'`=`allow_multiple_periods`');
                    }
                } catch(PDOException $e) {
                    // Se um processo externo adicionou a coluna antes, seguir.
                    if((int)($e->errorInfo[1]??0)!==1060 || !isset(schema_table_columns($table)[$column]))
                        throw $e;
                }
                $existing=schema_table_columns($table);
            }
        }
        return $changes;
    } finally {
        $pdo->query("SELECT RELEASE_LOCK('cf_schema_v9_names')");
    }
}

/** Additive migration: preserves existing bookings and their previous confirmation state. */
function closed_list_table_definitions(): array {
    return [
        'closed_list_approvals'=>"CREATE TABLE IF NOT EXISTS `closed_list_approvals` (
            `reservation_id` VARCHAR(36) NOT NULL PRIMARY KEY,
            `approval_status` VARCHAR(12) NOT NULL DEFAULT 'pending',
            `request_kind` VARCHAR(24) NOT NULL DEFAULT 'lista_fechada',
            `invitation_token` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
            `approval_reason` VARCHAR(1000) NOT NULL DEFAULT '',
            `reviewed_at` DATETIME NULL,
            `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY `uq_closed_invitation` (`invitation_token`),
            KEY `idx_closed_approval` (`approval_status`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        'closed_list_participants'=>"CREATE TABLE IF NOT EXISTS `closed_list_participants` (
            `id` VARCHAR(36) NOT NULL PRIMARY KEY,
            `reservation_id` VARCHAR(36) NOT NULL,
            `name` VARCHAR(120) NOT NULL,
            `whatsapp` VARCHAR(20) NOT NULL,
            `privacy_consent` TINYINT(1) NOT NULL DEFAULT 0,
            `public_name_consent` TINYINT(1) NOT NULL DEFAULT 0,
            `public_full_name_consent` TINYINT(1) NOT NULL DEFAULT 0,
            `edit_token_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL DEFAULT NULL,
            `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY `uq_closed_participant_phone` (`reservation_id`,`whatsapp`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    ];
}
