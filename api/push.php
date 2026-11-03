<?php
declare(strict_types=1);
/** Web Push para dispositivos do administrador. Sem bibliotecas de terceiros.
 * chaves privadas VAPID ficam apenas no MySQL; endpoints são aceitos via sessão + CSRF.
 */
function push_b64e(string $bytes):string{return rtrim(strtr(base64_encode($bytes),'+/','-_'),'=');}
function push_b64d(string $raw):string|false {
    if(!preg_match('/^[a-zA-Z0-9_-]+$/D',$raw))return false;
    return base64_decode(strtr($raw,'-_','+/').str_repeat('=',(4-strlen($raw)%4)%4),true);
}
function push_tables_ready():bool {
    $tables=db()->query("SHOW TABLES LIKE 'admin_push_subscriptions'")->fetchColumn();
    $keys=db()->query("SHOW TABLES LIKE 'push_vapid_keys'")->fetchColumn();
    return (bool)$tables && (bool)$keys;
}
function push_public_from_key($key):string {
    $details=openssl_pkey_get_details($key);
    if(!is_array($details)||strlen($details['ec']['x']??'')!==32||strlen($details['ec']['y']??'')!==32)throw new RuntimeException('Chave P-256 inválida.');
    return "\x04".$details['ec']['x'].$details['ec']['y'];
}
function push_new_key():array {
    if(!extension_loaded('openssl'))throw new RuntimeException('Extensão OpenSSL é necessária para Web Push.');
    $key=openssl_pkey_new(['private_key_type'=>OPENSSL_KEYTYPE_EC,'curve_name'=>'prime256v1']);
    if($key===false||!openssl_pkey_export($key,$pem))throw new RuntimeException('Não foi possível gerar chave VAPID.');
    return ['public_key'=>push_b64e(push_public_from_key($key)),'private_pem'=>$pem];
}
function push_vapid_keys():array {
    if(!push_tables_ready())throw new RuntimeException('Migração Web Push pendente.');
    $existing=row('SELECT public_key,private_pem FROM push_vapid_keys WHERE id=1');
    if($existing)return $existing;
    $locked=(int)db()->query("SELECT GET_LOCK('cf_push_vapid_generate', 8)")->fetchColumn();
    if($locked!==1)throw new RuntimeException('Outra instalação de notificações está sendo preparada.');
    try {
        $existing=row('SELECT public_key,private_pem FROM push_vapid_keys WHERE id=1');
        if($existing)return $existing;
        $generated=push_new_key();
        execute('INSERT INTO push_vapid_keys (id,public_key,private_pem) VALUES (1,?,?)',array_values($generated));
        return $generated;
    } finally {db()->query("SELECT RELEASE_LOCK('cf_push_vapid_generate')");}
}
/** Permitir somente provedores reais de push para evitar SSRF. */
function push_valid_endpoint(string $url):bool {
    if(strlen($url)>1500||!filter_var($url,FILTER_VALIDATE_URL))return false;
    $parts=parse_url($url);
    if(!is_array($parts)||strtolower($parts['scheme']??'')!=='https'||isset($parts['user'])||isset($parts['pass'])||isset($parts['port']))return false;
    $host=strtolower($parts['host']??'');
    return in_array($host,['fcm.googleapis.com','android.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'],true)
        || str_ends_with($host,'.push.apple.com');
}
function push_subscribe(string $adminId,array $subscription):array {
    if(!push_tables_ready())fail(409,'Atualize o MySQL no painel antes de ativar notificações no celular.');
    $url=$subscription['endpoint']??null;
    $keys=$subscription['keys']??null;
    if(!is_string($url)||!push_valid_endpoint($url)||!is_array($keys))fail(422,'Assinatura de notificações inválida.');
    $p256=$keys['p256dh']??null;$auth=$keys['auth']??null;
    $p=is_string($p256)?push_b64d($p256):false;
    $a=is_string($auth)?push_b64d($auth):false;
    if($p===false||strlen($p)!==65||$p[0]!=="\x04"||$a===false||strlen($a)!==16)fail(422,'Chaves de notificações inválidas.');
    // Cada navegador possui uma assinatura distinta; registrar somente no administrador autenticado.
    execute('INSERT INTO admin_push_subscriptions (id,admin_id,endpoint,p256dh,auth) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE admin_id=VALUES(admin_id),endpoint=VALUES(endpoint),p256dh=VALUES(p256dh),auth=VALUES(auth),updated_at=CURRENT_TIMESTAMP',
        [hash('sha256',$url),$adminId,$url,$p256,$auth]);
    // Limita dispositivos por conta; mantém as inscrições mais recentes.
    $records=rows('SELECT id FROM admin_push_subscriptions WHERE admin_id=? ORDER BY updated_at DESC',[$adminId]);
    foreach(array_slice($records,8) as $old)execute('DELETE FROM admin_push_subscriptions WHERE id=? AND admin_id=?',[$old['id'],$adminId]);
    return ['ok'=>true];
}
function push_unsubscribe(string $adminId,string $endpoint):array {
    if(!push_tables_ready())return ['ok'=>true];
    if(!push_valid_endpoint($endpoint))fail(422,'Assinatura inválida.');
    execute('DELETE FROM admin_push_subscriptions WHERE id=? AND admin_id=?',[hash('sha256',$endpoint),$adminId]);
    return ['ok'=>true];
}
function push_hkdf(string $salt,string $ikm,string $info,int $length):string {
    $prk=hash_hmac('sha256',$ikm,$salt,true);
    $t='';$okm='';$i=0;
    while(strlen($okm)<$length){$i++;$t=hash_hmac('sha256',$t.$info.chr($i),$prk,true);$okm.=$t;}
    return substr($okm,0,$length);
}
function push_encrypt(string $message,string $receiverKey,string $authKey):string {
    $recipient=push_b64d($receiverKey);$auth=push_b64d($authKey);
    if($recipient===false||strlen($recipient)!==65||$recipient[0]!=="\x04"||$auth===false||strlen($auth)!==16)throw new RuntimeException('Chaves inválidas para envio.');
    $server=openssl_pkey_new(['private_key_type'=>OPENSSL_KEYTYPE_EC,'curve_name'=>'prime256v1']);
    if(!$server)throw new RuntimeException('Falha ao gerar ECDH.');
    $serverPub=push_public_from_key($server);
    // DER SubjectPublicKeyInfo para EC P-256 (uncompressed point).
    $der=hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200').$recipient;
    $clientKey=openssl_pkey_get_public("-----BEGIN PUBLIC KEY-----\n".chunk_split(base64_encode($der),64,"\n")."-----END PUBLIC KEY-----\n");
    if($clientKey===false)throw new RuntimeException('Chave pública ECDH inválida.');
    $shared=openssl_pkey_derive($clientKey,$server,32);
    if($shared===false||strlen($shared)!==32)throw new RuntimeException('ECDH indisponível.');
    $ikm=push_hkdf($auth,$shared,"WebPush: info\x00".$recipient.$serverPub,32);
    $salt=random_bytes(16);
    $cek=push_hkdf($salt,$ikm,"Content-Encoding: aes128gcm\x00",16);
    $nonce=push_hkdf($salt,$ikm,"Content-Encoding: nonce\x00",12);
    $cipher=openssl_encrypt($message."\x02",'aes-128-gcm',$cek,OPENSSL_RAW_DATA,$nonce,$tag);
    if($cipher===false)throw new RuntimeException('Falha ao cifrar aviso.');
    return $salt.pack('N',4096).chr(strlen($serverPub)).$serverPub.$cipher.$tag;
}
/** Converter ECDSA ASN.1 DER (OpenSSL) para assinatura JOSE ES256 raw R||S. */
function push_jose_signature(string $der):string {
    $pos=0;
    if(ord($der[$pos++]??"\x00")!==0x30)throw new RuntimeException('Assinatura VAPID malformada.');
    $len=ord($der[$pos++]??"\x00");if($len>=128){$count=$len&127;$pos+=$count;}
    $parts=[];
    for($i=0;$i<2;$i++){
        if(ord($der[$pos++]??"\x00")!==0x02)throw new RuntimeException('Assinatura VAPID inválida.');
        $n=ord($der[$pos++]??"\x00");
        $part=ltrim(substr($der,$pos,$n),"\x00");$pos+=$n;
        if(strlen($part)>32)throw new RuntimeException('Componente VAPID inválido.');
        $parts[]=str_pad($part,32,"\x00",STR_PAD_LEFT);
    }
    return implode('',$parts);
}
function push_vapid_token(string $endpoint,string $privatePem):string {
    $parts=parse_url($endpoint);
    $aud='https://'.$parts['host'];
    $header=push_b64e('{"typ":"JWT","alg":"ES256"}');
    $claim=push_b64e(json_encode(['aud'=>$aud,'exp'=>time()+3600,'sub'=>'https://campoferrari.com.br/'],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR));
    $input=$header.'.'.$claim;
    if(!openssl_sign($input,$signature,$privatePem,OPENSSL_ALGO_SHA256))throw new RuntimeException('Falha VAPID.');
    return $input.'.'.push_b64e(push_jose_signature($signature));
}
function push_post(string $endpoint,string $message,array $vapid,string $p256,string $auth):int {
    $payload=push_encrypt($message,$p256,$auth);
    $headers=['TTL: 3600','Content-Encoding: aes128gcm','Content-Type: application/octet-stream',
        'Authorization: vapid t='.push_vapid_token($endpoint,$vapid['private_pem']).', k='.$vapid['public_key']];
    if(function_exists('curl_init')) {
        $ch=curl_init($endpoint);
        if($ch===false)throw new RuntimeException('cURL indisponível.');
        try {
            curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>$payload,CURLOPT_HTTPHEADER=>$headers,
                CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>4,CURLOPT_CONNECTTIMEOUT=>2,CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2,
                CURLOPT_FOLLOWLOCATION=>false]);
            $response=curl_exec($ch);
            if($response===false)throw new RuntimeException('Gateway Web Push não respondeu.');
            return (int)curl_getinfo($ch,CURLINFO_HTTP_CODE);
        } finally {curl_close($ch);}
    }
    // Fallback para hospedagem com OpenSSL, sem extensão curl.
    $ctx=stream_context_create([
        'http'=>['method'=>'POST','header'=>implode("\r\n",$headers),'content'=>$payload,'timeout'=>4,'ignore_errors'=>true],
        'ssl'=>['verify_peer'=>true,'verify_peer_name'=>true,'allow_self_signed'=>false]
    ]);
    @file_get_contents($endpoint,false,$ctx);
    foreach(($http_response_header??[]) as $line)if(preg_match('/^HTTP\/\S+ (\d{3})/',$line,$m))return (int)$m[1];
    throw new RuntimeException('Gateway Web Push indisponível.');
}
/** Envio só depois do commit; nunca inclui dados pessoais na notificação de tela bloqueada. */
function push_dispatch(array $reservation):array {
    if(!push_tables_ready())return ['sent'=>0,'failed'=>0,'status'=>'migration_required'];
    $subs=rows('SELECT id,endpoint,p256dh,auth FROM admin_push_subscriptions ORDER BY updated_at DESC LIMIT 8');
    if(!$subs)return ['sent'=>0,'failed'=>0];
    $vapid=push_vapid_keys();$sent=0;$failed=0;
    $isOpen=($reservation['kind']??'closed')==='open';
    $pendingApproval=($reservation['approval_status']??'')==='pending';
    $message=json_encode(['title'=>'Campo Ferrari · Novo agendamento',
        'body'=>$isOpen?'Nova inscrição na lista aberta. Abra o painel.':($pendingApproval?'Lista fechada aguardando aprovação. Abra o painel.':'Nova reserva na lista fechada. Abra o painel.'),
        'url'=>'/admin/','tag'=>'cf-'.$reservation['id']],JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
    foreach($subs as $sub){
        try {
            if(!push_valid_endpoint($sub['endpoint']))continue;
            $code=push_post($sub['endpoint'],$message,$vapid,$sub['p256dh'],$sub['auth']);
            if($code===404||$code===410){execute('DELETE FROM admin_push_subscriptions WHERE id=?',[$sub['id']]);continue;}
            if($code>=200&&$code<300)$sent++;else $failed++;
        }catch(Throwable $e){$failed++;error_log('Campo Ferrari Web Push: falha no provedor, sem detalhes de assinatura.');}
    }
    return ['sent'=>$sent,'failed'=>$failed];
}
