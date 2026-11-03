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
/** Recebe telefone nacional ou internacional (+55), persiste 55 + DDD + telefone. */
function phone(mixed $v): string {
    $raw = strval_safe($v,40);
    $digits = preg_replace('/\D/', '', $raw);
    if ((strlen($digits) === 12 || strlen($digits) === 13) && str_starts_with($digits,'55')) {
        $digits = substr($digits,2);
    }
    if (!preg_match('/^[1-9][1-9]\d{8,9}$/D', $digits))
        fail(422,'WhatsApp inválido. Informe DDD e número, com ou sem +55.');
    return '55'.$digits;
}
function valid_date(mixed $date,bool $allowPast=false): string {
    $d=(string)($date??'');$dt=DateTimeImmutable::createFromFormat('!Y-m-d',$d);
    if(!$dt || $dt->format('Y-m-d')!==$d) fail(422,'Data inválida.');
    if (!$allowPast && $d < date('Y-m-d')) fail(422,'Escolha uma data atual ou futura.');
    return $d;
}
function id(string $prefix): string {return $prefix.'_'.bin2hex(random_bytes(8));}
function periods(): array {return [['id'=>'manha','label'=>'Manhã','time'=>'08:00 às 13:00'],['id'=>'tarde','label'=>'Tarde','time'=>'13:30 às 18:30'],['id'=>'noite','label'=>'Noite','time'=>'19:00 às 23:30']];}
/** Turnos canônicos na ordem do calendário; nunca aceitar reservas ambíguas. */
function requested_periods(array $input): array {
    $raw=$input['periods']??[$input['period']??''];
    if(!is_array($raw) || count($raw)<1 || count($raw)>3 || array_values($raw)!==$raw)
        fail(422,'Escolha de um a três turnos válidos.');
    $allowed=['manha','tarde','noite'];
    if(count(array_unique($raw))!==count($raw))fail(422,'Turno repetido.');
    foreach($raw as $item) if(!is_string($item) || !in_array($item,$allowed,true))fail(422,'Turno inválido.');
    $selected=array_values(array_filter($allowed,static fn($id)=>in_array($id,$raw,true)));
    // A regra também é validada no servidor (prévia e criação), não só no navegador.
    // A lista fechada possui uma regra independente do evento privativo.
    $rules=settings();
    $policy=($input['modality']??'')==='evento_fechado'?'allow_multiple_periods_private':'allow_multiple_periods_closed';
    if(count($selected)>1 && (int)($rules[$policy]??$rules['allow_multiple_periods']??1)!==1)
        fail(422,'A escolha de vários turnos está desativada para esta modalidade. Atualize a página e selecione apenas um turno.');
    if(isset($input['period']) && $input['period']!==$selected[0])fail(422,'Os turnos não correspondem à reserva.');
    return $selected;
}
/** WHERE adicional compatível com reservas antigas (sem tabela extra). */
function reservation_period_match_sql(string $alias='r'): string {
    return reservation_periods_ready()
        ? "($alias.period=? OR EXISTS (SELECT 1 FROM reservation_periods rp WHERE rp.reservation_id=$alias.id AND rp.period=?))"
        : "$alias.period=?";
}
function reservation_period_match_params(string $period): array {
    return reservation_periods_ready()?[$period,$period]:[$period];
}
function reservation_period_ids(array $reservation): array {
    $periods=[$reservation['period']];
    if(reservation_periods_ready()) {
        foreach(rows('SELECT period FROM reservation_periods WHERE reservation_id=?',[$reservation['id']]) as $p)$periods[]=$p['period'];
    }
    $allowed=['manha','tarde','noite'];
    return array_values(array_filter($allowed,static fn($p)=>in_array($p,$periods,true)));
}
function active_statuses(): array {return ['pending','awaiting_payment','payment_sent','confirmed'];}
function available_periods(string $day): array {
    $approved=approved_reservation_sql();$approvedAlias=approved_reservation_sql('r');
    $blocked=row('SELECT id FROM blocked_dates WHERE booking_date=?',[$day]);
    // Um jogo de Lista Aberta bloqueia SOMENTE seu turno, não o dia inteiro.
    // A Lista Fechada pode usar os demais turnos livres na mesma data.
    $events=rows('SELECT period FROM open_events WHERE event_date=?',[$day]);
    $openPeriods=array_column($events,'period');
    $taken=rows("SELECT period FROM reservations WHERE booking_date=? AND status IN ('pending','awaiting_payment','payment_sent','confirmed') $approved",[$day]);
    $occupied=array_column($taken,'period');
    if(reservation_periods_ready()) {
        $extra=rows("SELECT rp.period FROM reservation_periods rp JOIN reservations r ON r.id=rp.reservation_id WHERE r.booking_date=? AND r.status IN ('pending','awaiting_payment','payment_sent','confirmed') $approvedAlias",[$day]);
        $occupied=array_merge($occupied,array_column($extra,'period'));
    }
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

/** A conta da galeria tem permissões reduzidas independentemente do estado antigo do MySQL.
 * Uma conta existente também é restringida imediatamente após esta publicação.
 */
function admin_access_role(string $email): string {
    return strcasecmp(trim($email),'novacriative@gmail.com')===0 ? 'photos' : 'admin';
}
/** Regra de autorização central: esconder abas no navegador não protege a API. */
function admin_route_permitted(string $role,string $method,string $path): bool {
    if($role==='admin')return true;
    if($role!=='photos')return false;
    if($path==='/auth/logout' && $method==='POST')return true;
    if($path==='/photos' && in_array($method,['GET','POST'],true))return true;
    return $method==='DELETE' && (bool)preg_match('#^/photos/CF-[0-9]{3,6}$#D',$path);
}

