<?php
declare(strict_types=1);
/** Notificações administrativas. Credenciais: somente config.local.php (não publicar no Git). */

/** Preferências permanecem desligadas enquanto a migração não for aplicada. */
function notification_preferences(): array {
    $columns = schema_table_columns('settings');
    $required = ['notification_email_enabled','notification_whatsapp_enabled','notification_email_to','notification_whatsapp_to'];
    foreach ($required as $column) if (!isset($columns[$column])) {
        return ['ready'=>false,'email_enabled'=>false,'whatsapp_enabled'=>false,'email_to'=>'','whatsapp_to'=>''];
    }
    $s = settings();
    return ['ready'=>true,'email_enabled'=>(bool)($s['notification_email_enabled']??false),
        'whatsapp_enabled'=>(bool)($s['notification_whatsapp_enabled']??false),
        'email_to'=>(string)($s['notification_email_to']??''),
        'whatsapp_to'=>(string)($s['notification_whatsapp_to']??'')];
}

function notification_secrets(): array {
    $file=__DIR__.'/config.local.php';
    return is_file($file) ? (array)(require $file) : [];
}
function notification_readiness(): array {
    $cfg=notification_secrets();
    $smtp=$cfg['notification_smtp']??[];
    $wa=$cfg['notification_whatsapp_cloud']??[];
    return [
        'email'=>is_array($smtp) && !empty($smtp['host']) && !empty($smtp['username']) && !empty($smtp['password']) && filter_var($smtp['from_email']??'',FILTER_VALIDATE_EMAIL)!==false,
        'whatsapp'=>is_array($wa) && !empty($wa['access_token']) && !empty($wa['phone_number_id']) && !empty($wa['template_name']) && function_exists('curl_init'),
    ];
}
function notification_admin_config(): array {
    return ['preferences'=>notification_preferences(),'configured'=>notification_readiness()];
}
function notification_recipient_phone(string $raw): string {
    $digits=preg_replace('/\D/','',$raw);
    if(!preg_match('/^\d{12,15}$/',$digits)) fail(422,'Informe WhatsApp de destino com código do país + DDD (ex.: 5549999999999).');
    return $digits;
}
function notification_update_preferences(array $input): array {
    $preferences=notification_preferences();
    if(!$preferences['ready'])fail(409,'Atualize primeiro as colunas do banco em Configurações > Manutenção do MySQL.');
    $emailTo=trim((string)($input['email_to']??''));
    $whatsappTo=trim((string)($input['whatsapp_to']??''));
    if(strlen($emailTo)>190||($emailTo!==''&&!filter_var($emailTo,FILTER_VALIDATE_EMAIL)))fail(422,'E-mail do administrador inválido.');
    $emailEnabled=($input['email_enabled']??false)===true;
    $whatsappEnabled=($input['whatsapp_enabled']??false)===true;
    $ready=notification_readiness();
    if($emailEnabled&&(!$ready['email']||$emailTo===''))fail(422,'Configure o SMTP em config.local.php e o e-mail de destino antes de ativar os avisos por e-mail.');
    if($whatsappEnabled&&(!$ready['whatsapp']||$whatsappTo===''))fail(422,'Configure a API oficial do WhatsApp e o destinatário antes de ativar os avisos.');
    if($whatsappTo!=='')$whatsappTo=notification_recipient_phone($whatsappTo);
    execute('UPDATE settings SET notification_email_enabled=?, notification_whatsapp_enabled=?, notification_email_to=?, notification_whatsapp_to=? WHERE id=1',
        [(int)$emailEnabled,(int)$whatsappEnabled,$emailTo,$whatsappTo]);
    return notification_admin_config();
}

function notification_details(array $reservation): array {
    $date=DateTimeImmutable::createFromFormat('!Y-m-d',(string)($reservation['date']??''));
    $periodLabel=['manha'=>'Manhã','tarde'=>'Tarde','noite'=>'Noite'];
    $name=preg_replace('/[\r\n\t]+/',' ',(string)($reservation['customer_name']??''));
    $rid=(string)($reservation['id']??'');
    return ['name'=>$name,'date'=>$date?$date->format('d/m/Y'):(string)($reservation['date']??''),
        'period'=>implode(' + ',array_map(static fn($p)=>$periodLabel[$p]??$p,$reservation['periods']??[$reservation['period']??''])),
        'count'=>(string)($reservation['player_count']??''),'id'=>$rid];
}

/** SMTP autenticado com STARTTLS (587) ou TLS direto (465). Sem bibliotecas externas. */
function notification_smtp_send(array $smtp,string $to,string $subject,string $message): void {
    $host=(string)$smtp['host'];
    if(!preg_match('/^[A-Za-z0-9.-]+$/D',$host))throw new RuntimeException('Host SMTP inválido.');
    $port=(int)($smtp['port']??587);
    $mode=strtolower((string)($smtp['encryption']??'tls'));
    if(!in_array($mode,['tls','ssl'],true)||$port<1||$port>65535)throw new RuntimeException('Configuração SMTP inválida.');
    if(!filter_var($to,FILTER_VALIDATE_EMAIL)||!filter_var($smtp['from_email']??'',FILTER_VALIDATE_EMAIL))throw new RuntimeException('Destinatário ou remetente SMTP inválido.');
    if(preg_match('/[\r\n]/',$to.$smtp['from_email']))throw new RuntimeException('Cabeçalho SMTP inválido.');
    $context=stream_context_create(['ssl'=>['verify_peer'=>true,'verify_peer_name'=>true,'allow_self_signed'=>false]]);
    $socket=@stream_socket_client(($mode==='ssl'?'ssl://':'tcp://').$host.':'.$port,$errno,$errstr,5,STREAM_CLIENT_CONNECT,$context);
    if(!$socket)throw new RuntimeException('Conexão SMTP indisponível.');
    stream_set_timeout($socket,5);
    try {
        $read=function(array $codes)use($socket):string{
            $raw='';
            do {
                $line=fgets($socket,2048);
                if($line===false||strlen($raw)>16000)throw new RuntimeException('Resposta SMTP inválida.');
                $raw.=$line;
            }while(isset($line[3])&&$line[3]==='-');
            $code=(int)substr($line,0,3);
            if(!in_array($code,$codes,true))throw new RuntimeException('Servidor SMTP rejeitou a etapa ('.$code.').');
            return $raw;
        };
        $write=function(string $command,array $accepted)use($socket,$read):string{
            if(fwrite($socket,$command."\r\n")===false)throw new RuntimeException('Falha ao enviar comando SMTP.');
            return $read($accepted);
        };
        $read([220]);
        $write('EHLO campoferrari.com.br',[250]);
        if($mode==='tls') {
            $write('STARTTLS',[220]);
            if(stream_socket_enable_crypto($socket,true,STREAM_CRYPTO_METHOD_TLS_CLIENT)!==true)throw new RuntimeException('STARTTLS falhou.');
            $write('EHLO campoferrari.com.br',[250]);
        }
        $write('AUTH LOGIN',[334]);
        $write(base64_encode((string)$smtp['username']),[334]);
        $write(base64_encode((string)$smtp['password']),[235]);
        $from=(string)$smtp['from_email'];
        $write('MAIL FROM:<'.$from.'>',[250]);
        $write('RCPT TO:<'.$to.'>',[250,251]);
        $write('DATA',[354]);
        $subject='=?UTF-8?B?'.base64_encode($subject).'?=';
        $headers="From: Campo Ferrari <{$from}>\r\nTo: <{$to}>\r\nSubject: {$subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit";
        $body=preg_replace('/\r\n|\r|\n/',"\r\n",$message);
        $body=preg_replace('/(^|\r\n)\./','${1}..',$body);
        $write($headers."\r\n\r\n".$body."\r\n.",[250]);
        $write('QUIT',[221]);
    } finally {fclose($socket);}
}

/** Cloud API oficial: mensagens de iniciativa da empresa requerem template aprovado. */
function notification_whatsapp_send(array $cfg,string $recipient,array $d): void {
    $phoneId=(string)$cfg['phone_number_id'];
    if(!preg_match('/^\d{5,25}$/D',$phoneId))throw new RuntimeException('Phone number ID inválido.');
    $name=(string)$cfg['template_name'];
    if(!preg_match('/^[a-z0-9_]{2,80}$/D',$name))throw new RuntimeException('Template do WhatsApp inválido.');
    $version=(string)($cfg['graph_version']??'v23.0');
    if(!preg_match('/^v\d+\.\d+$/D',$version))throw new RuntimeException('Versão da Graph API inválida.');
    $payload=['messaging_product'=>'whatsapp','to'=>$recipient,'type'=>'template',
        'template'=>['name'=>$name,'language'=>['code'=>$cfg['language_code']??'pt_BR'],
            'components'=>[['type'=>'body','parameters'=>array_map(static fn($v)=>['type'=>'text','text'=>$v],
                [$d['name'],$d['date'],$d['period'],$d['count']])]]]];
    $ch=curl_init('https://graph.facebook.com/'.$version.'/'.$phoneId.'/messages');
    if(!$ch)throw new RuntimeException('WhatsApp API indisponível.');
    try {
        curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_RETURNTRANSFER=>true,
            CURLOPT_HTTPHEADER=>['Authorization: Bearer '.$cfg['access_token'],'Content-Type: application/json'],
            CURLOPT_POSTFIELDS=>json_encode($payload,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR),
            CURLOPT_TIMEOUT=>8,CURLOPT_CONNECTTIMEOUT=>4,CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2]);
        $res=curl_exec($ch);$http=(int)curl_getinfo($ch,CURLINFO_HTTP_CODE);
        if($res===false||$http<200||$http>=300)throw new RuntimeException('WhatsApp API recusou envio (HTTP '.$http.').');
        $parsed=json_decode($res,true);
        if(!is_array($parsed)||empty($parsed['messages'][0]['id']))throw new RuntimeException('WhatsApp API não confirmou aceitação da mensagem.');
    } finally {curl_close($ch);}
}

/** Captura falhas SEM cancelar reserva já concluída nem expor chaves aos visitantes. */
function notification_dispatch(array $reservation,?string $onlyChannel=null):array {
    $prefs=notification_preferences();$ready=notification_readiness();$cfg=notification_secrets();
    $d=notification_details($reservation);$out=[];
    $pendingApproval=($reservation['approval_status']??'')==='pending';
    $kind=($reservation['kind']??'closed')==='open'?'Inscrição na Lista Aberta':($pendingApproval?'Solicitação de Lista Fechada — aguardando aprovação':'Reserva da Lista Fechada');
    // Disparar push primeiro para minimizar a espera antes dos provedores SMTP/WhatsApp.
    if($onlyChannel===null){
        try {$out['push']=push_dispatch($reservation);}
        catch(Throwable $e){error_log('Campo Ferrari: falha isolada no Web Push.');$out['push']=['sent'=>0,'failed'=>1];}
    }
    foreach(['email','whatsapp'] as $channel){
        if($onlyChannel!==null&&$channel!==$onlyChannel)continue;
        $enabled=$prefs[$channel.'_enabled']??false;
        if(!$prefs['ready']||!$enabled){$out[$channel]='disabled';continue;}
        if(!$ready[$channel]||empty($prefs[$channel.'_to'])){$out[$channel]='not_configured';continue;}
        try {
            if($channel==='email'){
                $subject=$pendingApproval?'Solicitação aguardando aprovação — Campo Ferrari':'Novo jogo marcado — Campo Ferrari';
                $instruction=$pendingApproval?'Abra o painel para aprovar ou recusar. Após aprovar, copie o convite para os jogadores.':'Confira jogadores, equipamentos e pagamento no painel.';
                $message="{$subject}\nTipo: {$kind}\n\nResponsável: {$d['name']}\nData: {$d['date']}\nTurno: {$d['period']}\nJogadores: {$d['count']}\nProtocolo: {$d['id']}\n\n{$instruction}\nhttps://campoferrari.com.br/admin/\n";
                notification_smtp_send($cfg['notification_smtp'],$prefs['email_to'],$subject,$message);
            } else notification_whatsapp_send($cfg['notification_whatsapp_cloud'],$prefs['whatsapp_to'],$d);
            $out[$channel]='accepted';
        }catch(Throwable $e){
            error_log('Campo Ferrari notification '.$channel.' '.$d['id'].': '.preg_replace('/[\r\n]/',' ',str_replace((string)($cfg['notification_whatsapp_cloud']['access_token']??'########'),'[REDACTED]',$e->getMessage())));
            $out[$channel]='failed';
        }
    }
    return $out;
}
