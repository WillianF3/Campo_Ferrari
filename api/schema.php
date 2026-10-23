<?php
declare(strict_types=1);
/**
 * Colunas usadas pelas duas modalidades de lista.
 * Nao consulta information_schema (algumas hospedagens compartilhadas o bloqueiam).
 * Nomes de tabelas e colunas sao constantes, nao entradas do navegador.
 */
function schema_definitions(): array {
    return [
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
    foreach(schema_definitions() as $table=>$definitions){
        $present=schema_table_columns($table);
        foreach($definitions as $column=>$type){
            if(!isset($present[$column]))$missing[]=$table.'.'.$column;
        }
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
        foreach(schema_definitions() as $table=>$definitions){
            $existing=schema_table_columns($table);
            foreach($definitions as $column=>$type){
                if(isset($existing[$column]))continue;
                try {
                    $pdo->exec('ALTER TABLE `'.$table.'` ADD COLUMN `'.$column.'` '.$type);
                    $changes[]=$table.'.'.$column;
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
