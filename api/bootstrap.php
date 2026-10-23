<?php
declare(strict_types=1);
// Banco: preencher api/config.local.php a partir de api/config.example.php; nao enviar a producao.
date_default_timezone_set('America/Sao_Paulo');
function db(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;
    $cfgFile = __DIR__ . '/config.local.php';
    if (!is_file($cfgFile)) throw new RuntimeException('Banco não configurado. Copie api/config.example.php para api/config.local.php.');
    $config = require $cfgFile;
    if(!extension_loaded('pdo_mysql')) throw new RuntimeException('Extensão PHP pdo_mysql não ativada.');
    $pdo = new PDO('mysql:host='.$config['host'].';port='.$config['port'].';dbname='.$config['database'].';charset=utf8mb4',
        $config['username'], $config['password'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::MYSQL_ATTR_INIT_COMMAND => "SET time_zone = '-03:00'",
        ]);
    return $pdo;
}
function rows(string $sql, array $args=[]): array { $s=db()->prepare($sql); $s->execute($args);return $s->fetchAll(); }
function row(string $sql,array $args=[]): ?array { $s=db()->prepare($sql);$s->execute($args);return $s->fetch() ?: null; }
function execute(string $sql,array $args=[]): int { $s=db()->prepare($sql);$s->execute($args);return $s->rowCount(); }
function result(mixed $value, int $code=200): never {http_response_code($code);header('Content-Type: application/json; charset=utf-8');echo json_encode($value, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_INVALID_UTF8_SUBSTITUTE);exit;}
function fail(int $code,string $message): never {result(['detail'=>$message],$code);}
function data(): array { $raw=file_get_contents('php://input'); if (strlen($raw)>64000) fail(413,'Solicitação muito grande.'); $v=json_decode($raw,true); if (!is_array($v)) fail(400,'JSON inválido.'); return $v; }
function strval_safe(mixed $v,int $max=120): string { $s=trim((string)($v??''));if ((function_exists('mb_strlen') ? mb_strlen($s) : strlen($s))>$max) fail(422,'Campo ultrapassa o limite de caracteres.');return $s; }
function require_string(array $v,string $key,int $max=120): string {$s=strval_safe($v[$key]??'', $max);if($s==='')fail(422,'Preencha o campo '.$key.'.');return $s;}
/** Confere todos os nomes de acompanhantes antes de registrar uma lista aberta. */
function validate_open_list_names(mixed $companions,int $people): string {
    if($people<1||$people>100||!is_array($companions)||array_values($companions)!==$companions||count($companions)!==$people-1)
        fail(422,'Informe o nome de cada participante adicional.');
    $validated=[];
    foreach($companions as $pos=>$companion){
        if(!is_string($companion))fail(422,'Nome de participante inválido.');
        $cleanName=strval_safe($companion,120);
        if((function_exists('mb_strlen')?mb_strlen($cleanName):strlen($cleanName))<2)
            fail(422,'Preencha o nome do participante '.($pos+2).'.');
        $validated[]=$cleanName;
    }
    $json=json_encode($validated,JSON_UNESCAPED_UNICODE|JSON_INVALID_UTF8_SUBSTITUTE);
    if($json===false)fail(422,'Nomes de participantes inválidos.');
    return $json;
}
function phone(mixed $v): string {$p=strval_safe($v,40);$digits=preg_replace('/\D/','',$p);if(strlen($digits)<10||strlen($digits)>13)fail(422,'Informe WhatsApp válido com DDD.');return $p;}
function valid_date(mixed $date,bool $allowPast=false): string {
    $d=(string)($date??'');$dt=DateTimeImmutable::createFromFormat('!Y-m-d',$d);
    if(!$dt || $dt->format('Y-m-d')!==$d) fail(422,'Data inválida.');
    if (!$allowPast && $d < date('Y-m-d')) fail(422,'Escolha uma data atual ou futura.');
    return $d;
}
function id(string $prefix): string {return $prefix.'_'.bin2hex(random_bytes(8));}
function periods(): array {return [['id'=>'manha','label'=>'Manhã','time'=>'08:00 às 13:00'],['id'=>'tarde','label'=>'Tarde','time'=>'13:30 às 18:30'],['id'=>'noite','label'=>'Noite','time'=>'19:00 às 23:30']];}
function active_statuses(): array {return ['pending','awaiting_payment','payment_sent','confirmed'];}
function available_periods(string $day): array {
    $blocked=row('SELECT id FROM blocked_dates WHERE booking_date=?',[$day]);
    // Um jogo de Lista Aberta bloqueia SOMENTE seu turno, não o dia inteiro.
    // A Lista Fechada pode usar os demais turnos livres na mesma data.
    $events=rows('SELECT period FROM open_events WHERE event_date=?',[$day]);
    $openPeriods=array_column($events,'period');
    $taken=rows("SELECT period FROM reservations WHERE booking_date=? AND status IN ('pending','awaiting_payment','payment_sent','confirmed')",[$day]);
    $occupied=array_column($taken,'period');
    $startTimes=['manha'=>'08:00','tarde'=>'13:30','noite'=>'19:00'];
    if ($day===date('Y-m-d')) foreach($startTimes as $id=>$time) if(date('H:i')>=$time)$occupied[]=$id;
    return array_map(static function($p) use($blocked,$openPeriods,$occupied){
        $p['status']=$blocked?'blocked':(in_array($p['id'],$openPeriods,true)?'open_event':(in_array($p['id'],$occupied,true)?'taken':'available'));
        return $p;
    },periods());
}
function rate_limit(string $route,int $limit=8): void {
    $ip=$_SERVER['REMOTE_ADDR']??'unknown';$key=hash('sha256',$route.'|'.$ip);
    execute('INSERT INTO api_rate_limits (bucket,attempts,window_start) VALUES (?,1,NOW()) ON DUPLICATE KEY UPDATE attempts=IF(window_start < DATE_SUB(NOW(),INTERVAL 10 MINUTE),1,attempts+1),window_start=IF(window_start < DATE_SUB(NOW(),INTERVAL 10 MINUTE),NOW(),window_start)',[$key]);
    $r=row('SELECT attempts FROM api_rate_limits WHERE bucket=?',[$key]);
    if((int)$r['attempts']>$limit)fail(429,'Muitas tentativas. Aguarde dez minutos.');
}
function json_num($value):float {return round((float)$value,2);}
function settings():array {return row('SELECT * FROM settings WHERE id=1')??[];}
function lock_day(string $date): void {
    execute('INSERT IGNORE INTO calendar_days (booking_date) VALUES (?)',[$date]);
    row('SELECT booking_date FROM calendar_days WHERE booking_date=? FOR UPDATE',[$date]);
}
function session_start_secure():void {
    if(session_status()===PHP_SESSION_ACTIVE)return;
    ini_set('session.use_strict_mode','1');ini_set('session.use_only_cookies','1');
    session_name('CF_ADMIN');
    session_set_cookie_params(['httponly'=>true,'secure'=>!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS']!=='off','samesite'=>'Lax','path'=>'/']);
    session_start();
}
function csrf():string {session_start_secure();if(!isset($_SESSION['csrf']))$_SESSION['csrf']=bin2hex(random_bytes(24));return $_SESSION['csrf'];}
function require_admin():array {session_start_secure();if(empty($_SESSION['admin_id']))fail(401,'Faça login no painel.');return ['id'=>$_SESSION['admin_id'],'email'=>$_SESSION['admin_email']??''];}
function require_csrf():void {session_start_secure();$given=$_SERVER['HTTP_X_CSRF_TOKEN']??'';if(!hash_equals(csrf(),$given))fail(403,'Sessão inválida. Atualize a página.');}
