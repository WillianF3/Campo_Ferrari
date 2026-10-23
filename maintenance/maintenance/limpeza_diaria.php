<?php
/**
 * Limpeza automática segura: execução via Cron Job / PHP CLI (1 vez ao dia).
 * Não apaga reservas, eventos, produtos, usuários administrativos nem inscrições
 * ativas em jogos futuros. Não coloque esta rotina em uma URL pública.
 *
 * Exemplo Hostinger: PHP CLI /CAMINHO/public_html/maintenance/limpeza_diaria.php
 * Teste sem exclusão: php limpeza_diaria.php --simular
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require_once __DIR__.'/../api/bootstrap.php';
$simular=in_array('--simular', $argv, true) || in_array('--dry-run', $argv, true);
try {
    // GET_LOCK evita execuções simultâneas do Cron.
    $obtained=row("SELECT GET_LOCK('campo_ferrari_limpeza_diaria_v1',0) AS locked");
    if((int)($obtained['locked']??0)!==1) {
        fwrite(STDERR,"Uma limpeza diária já está em execução.\n");
        exit(2);
    }
    try {
        // Somente mensagens já atendidas há pelo menos 24 horas.
        $suggestionsSql="FROM suggestions WHERE created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR) AND status IN ('contacted','resolved','archived')";
        // Inscrições arquivadas, ou inscrições de eventos concluídos há mais
        // de 24 horas desde o fim do dia do evento (margem de segurança).
        // Registros sem evento também são elegíveis APENAS se arquivados,
        // ou se tinham uma data de interesse antiga.
        $openFrom="FROM open_list ol LEFT JOIN open_events e ON e.id=ol.event_id";
        $openWhere="WHERE ol.created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR) AND (ol.status='archived' OR COALESCE(e.event_date,ol.preferred_date) < DATE_SUB(CURDATE(), INTERVAL 1 DAY))";
        $beforeSuggestions=(int)(row("SELECT COUNT(*) AS n $suggestionsSql")['n']??0);
        $beforeOpen=(int)(row("SELECT COUNT(*) AS n $openFrom $openWhere")['n']??0);
        if($simular){
            echo json_encode(['modo'=>'simulacao','sugestoes_elegiveis'=>$beforeSuggestions,'inscricoes_elegiveis'=>$beforeOpen],JSON_UNESCAPED_UNICODE|JSON_PRETTY_PRINT)."\n";
        }else{
            db()->beginTransaction();
            try {
                $suggestionsDeleted=execute("DELETE $suggestionsSql");
                $openDeleted=execute("DELETE ol $openFrom $openWhere");
                db()->commit();
            }catch(Throwable $error){if(db()->inTransaction())db()->rollBack();throw $error;}
            echo json_encode(['modo'=>'executado','data'=>date('c'),'sugestoes_excluidas'=>$suggestionsDeleted,'inscricoes_excluidas'=>$openDeleted],JSON_UNESCAPED_UNICODE|JSON_PRETTY_PRINT)."\n";
        }
    }finally{
        row("SELECT RELEASE_LOCK('campo_ferrari_limpeza_diaria_v1') AS released");
    }
}catch(Throwable $error){
    error_log('Campo Ferrari limpeza diária: '.$error->getMessage());
    fwrite(STDERR,"Não foi possível completar a limpeza diária. Confira o banco e os logs PHP.\n");
    exit(1);
}
