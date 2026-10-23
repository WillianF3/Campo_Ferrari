<?php
declare(strict_types=1);
require_once __DIR__.'/bootstrap.php';
require_once __DIR__.'/schema.php';
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
$uri = parse_url($_SERVER['REQUEST_URI']??'/api/',PHP_URL_PATH) ?: '/api/';
$offset = strrpos($uri,'/api');
$path = $offset===false?'/':substr($uri,$offset+4);
$path = rtrim($path,'/') ?: '/';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if($method==='OPTIONS') fail(405,'Método não permitido.');
try { route($method,$path); }
catch (PDOException $e) {
    error_log('Campo Ferrari SQL: '.$e->getMessage());
    $sqlState = (string)($e->errorInfo[0] ?? $e->getCode());
    if (in_array($sqlState, ['42S02','42S22'], true)) {
        result(['detail'=>'O banco está conectado, mas a estrutura das tabelas precisa ser conferida.','code'=>'DATABASE_SCHEMA_MISMATCH'],503);
    }
    result(['detail'=>'Não foi possível conectar ao MySQL. Confira os dados em api/config.local.php e o serviço do banco.','code'=>'DATABASE_UNAVAILABLE'],503);
}
catch (RuntimeException $e) {
    error_log('Campo Ferrari backend: '.$e->getMessage());
    $configMissing = !is_file(__DIR__.'/config.local.php');
    result(['detail'=>$configMissing?'Configuração do banco ausente no servidor. Preserve o arquivo api/config.local.php.':'O PHP não está pronto para conectar ao banco. Confira as extensões e a configuração.','code'=>$configMissing?'CONFIG_MISSING':'SERVER_CONFIG_ERROR'],503);
}
catch (Throwable $e) { error_log('Campo Ferrari API: '.$e->getMessage());result(['detail'=>'Ocorreu um erro interno. Consulte o log de erros do PHP.','code'=>'INTERNAL_ERROR'],500); }

function catalog(string $kind,bool $public=true):array {
    if (!in_array($kind,['equipment','accessories','ammo'],true)) fail(404,'Recurso inexistente.');
    $sql="SELECT * FROM $kind".($public?' WHERE active=1':'').($kind==='ammo'?' ORDER BY name':' ORDER BY sort_order,name');
    return array_map(static function($r){$r['price']=(float)$r['price'];$r['active']=(bool)$r['active'];$r['order']=(int)($r['sort_order']??0);unset($r['sort_order']);return $r;},rows($sql));
}
function product_lines(array $selections,string $table):array {
    $group=[];
    foreach($selections as $s) {
        if(!is_array($s))fail(422,'Item inválido.');
        $key=strval_safe($s['id']??'',36);$qty=$s['qty']??null;
        if(!$key||filter_var($qty,FILTER_VALIDATE_INT)===false||(int)$qty<1||(int)$qty>100)fail(422,'Quantidade de item inválida.');
        $group[$key]=($group[$key]??0)+(int)$qty;
        if($group[$key]>100) fail(422,'Quantidade máxima por item ultrapassada.');
    }
    $lines=[];
    foreach($group as $productId=>$qty) {
        $item=row("SELECT id,name,price,active".($table==='equipment'?',units_available':'')." FROM $table WHERE id=?",[$productId]);
        if(!$item||!(int)$item['active'])fail(422,'Produto indisponível. Atualize a página.');
        $lines[]=['id'=>$productId,'name'=>$item['name'],'qty'=>$qty,'unit_price'=>(float)$item['price'],'total'=>round($qty*(float)$item['price'],2),'units_available'=>$item['units_available']??null];
    }
    return $lines;
}
function calc(array $input,bool $checkSlot=true):array {
    $date=valid_date($input['date']??null);
    $period=strval_safe($input['period']??'',12);
    if(!in_array($period,['manha','tarde','noite'],true))fail(422,'Selecione um turno válido.');
    if(($input['modality']??'')!=='lista_fechada')fail(422,'Modalidade inválida.');
    $count=filter_var($input['player_count']??null,FILTER_VALIDATE_INT);
    if($count===false||$count<4||$count>10)fail(422,'Lista fechada exige entre 4 e 10 jogadores.');
    if($checkSlot) {
        $periods=available_periods($date);
        $selected=array_values(array_filter($periods,static fn($p)=>$p['id']===$period))[0];
        if($selected['status']!=='available')fail(409,'Data ou turno já indisponível. Escolha outro.');
    }
    $players=$input['players']??[];
    if(!is_array($players)||count($players)!==$count)fail(422,'A lista de jogadores está incompleta.');
    $fromPlayers=[];
    foreach($players as $p) {
        if(!is_array($p))fail(422,'Jogador inválido.');
        $choice=strval_safe($p['equipment_id']??'',36);
        if($choice!=='')$fromPlayers[$choice]=($fromPlayers[$choice]??0)+1;
    }
    $equipment=product_lines($input['equipment_selections']??[],'equipment');
    $requested=[];foreach($equipment as $e){$requested[$e['id']]=$e['qty'];}
    if($fromPlayers!==$requested) {
        ksort($fromPlayers);ksort($requested);
        if($fromPlayers!==$requested)fail(422,'Quantidade de equipamentos não corresponde aos jogadores.');
    }
    foreach($equipment as $e) {
        if($e['qty']>(int)$e['units_available'])fail(409,'Equipamento '.$e['name'].' não possui unidades suficientes.');
        $reserved=row("SELECT COALESCE(SUM(ri.qty),0) AS qty FROM reservation_items ri JOIN reservations r ON r.id=ri.reservation_id WHERE ri.item_type='equipment' AND ri.product_id=? AND r.booking_date=? AND r.period=? AND r.status IN ('pending','awaiting_payment','payment_sent','confirmed')",[$e['id'],$date,$period]);
        if($e['qty']+(int)$reserved['qty']>(int)$e['units_available'])fail(409,'Estoque de '.$e['name'].' alterado. Escolha outro.');
    }
    $accessories=product_lines($input['accessory_selections']??[],'accessories');
    $ammo=product_lines($input['ammo_selections']??[],'ammo');
    $s=settings();$entry=(float)($s['entry_fee']??0);$percent=(float)($s['deposit_percent']??50);
    $entryTotal=round($entry*$count,2);$eqTotal=array_sum(array_column($equipment,'total'));$acTotal=array_sum(array_column($accessories,'total'));$ammoTotal=array_sum(array_column($ammo,'total'));
    $total=round($entryTotal+$eqTotal+$acTotal+$ammoTotal,2);$deposit=round($total*$percent/100,2);
    $publicLines=static fn($list)=>array_map(static function($l){unset($l['units_available']);return $l;},$list);
    return [
        'entry_fee_per_person'=>$entry,'entry_total'=>$entryTotal,'equipment_total'=>$eqTotal,'equipment_details'=>$publicLines($equipment),
        'accessory_total'=>$acTotal,'accessory_details'=>$publicLines($accessories),'ammo_total'=>$ammoTotal,'ammo_details'=>$publicLines($ammo),
        'total'=>$total,'deposit_percent'=>$percent,'deposit_amount'=>$deposit,'remaining'=>round($total-$deposit,2),
    ];
}
function save_reservation(array $input):array {
    if(($input['responsible_adult']??false)!==true)fail(422,'A solicitação precisa ser feita por um responsável maior de idade.');
    rate_limit('reservations',12);
    $name=require_string($input,'customer_name');$whatsapp=phone($input['customer_whatsapp']??null);
    $notes=strval_safe($input['notes']??'',1000);
    // Todos os jogadores da lista fechada são identificados para a equipe.
    // Esses nomes jamais entram nos endpoints públicos de calendário ou eventos.
    $rawPlayers=$input['players']??null;
    if(!is_array($rawPlayers) || count($rawPlayers)!==(int)($input['player_count']??0))
        fail(422,'Informe o nome de todos os jogadores.');
    $playerNames=[];
    foreach($rawPlayers as $i=>$player) {
        if(!is_array($player) || !is_string($player['name']??null))
            fail(422,'Informe o nome do jogador '.($i+1).'.');
        $clean=strval_safe($player['name'],120);
        if((function_exists('mb_strlen')?mb_strlen($clean):strlen($clean))<2)
            fail(422,'Informe o nome do jogador '.($i+1).'.');
        $playerNames[]=$clean;
    }
    if(!column_exists('reservation_players','player_name'))
        fail(503,'Atualização de nomes da lista fechada pendente no MySQL. Execute a migração SQL.');
    $day=valid_date($input['date']??null);
    db()->beginTransaction();
    try {
        lock_day($day);
        $totals=calc($input);
        $rid=id('res');
        $sql='INSERT INTO reservations (id,modality,booking_date,period,player_count,customer_name,customer_whatsapp,notes,status,entry_fee,entry_total,equipment_total,accessory_total,ammo_total,total,deposit_percent,deposit_amount,remaining) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
        execute($sql,[$rid,'lista_fechada',$day,$input['period'],(int)$input['player_count'],$name,$whatsapp,$notes,'pending',
            $totals['entry_fee_per_person'],$totals['entry_total'],$totals['equipment_total'],$totals['accessory_total'],$totals['ammo_total'],$totals['total'],$totals['deposit_percent'],$totals['deposit_amount'],$totals['remaining']]);
        foreach(['equipment'=>'equipment_details','accessory'=>'accessory_details','ammo'=>'ammo_details'] as $type=>$field) {
            foreach($totals[$field] as $item) execute('INSERT INTO reservation_items (reservation_id,item_type,product_id,item_name,qty,unit_price,line_total) VALUES (?,?,?,?,?,?,?)',[$rid,$type,$item['id'],$item['name'],$item['qty'],$item['unit_price'],$item['total']]);
        }
        foreach($input['players'] as $i=>$player)
            execute('INSERT INTO reservation_players (reservation_id,player_number,player_name,equipment_id) VALUES (?,?,?,?)',
                [$rid,$i+1,$playerNames[$i],($player['equipment_id']??null)?:null]);
        db()->commit();
        $period=array_values(array_filter(periods(),static fn($p)=>$p['id']===$input['period']))[0];
        return array_merge($totals,['id'=>$rid,'date'=>$day,'period'=>$input['period'],'period_label'=>$period['label'],'period_time'=>$period['time'],
            'player_count'=>(int)$input['player_count'],'players'=>$playerNames,
            'status'=>'pending','created_at'=>date('c')]);
    } catch(Throwable $e) {if(db()->inTransaction())db()->rollBack();throw $e;}
}
function equipment_availability(string $date,string $period):array {
    $r=[];foreach(catalog('equipment') as $eq){
        $used=row("SELECT COALESCE(SUM(ri.qty),0) AS qty FROM reservation_items ri JOIN reservations r ON r.id=ri.reservation_id WHERE ri.item_type='equipment' AND ri.product_id=? AND r.booking_date=? AND r.period=? AND r.status IN ('pending','awaiting_payment','payment_sent','confirmed')",[$eq['id'],$date,$period]);
        $eq['units_reserved']=(int)$used['qty'];$eq['units_free']=max(0,(int)$eq['units_available']-$eq['units_reserved']);$r[]=$eq;
    }return $r;
}
function admin_route(string $method,string $path):void {
    if($path==='/auth/login' && $method==='POST') {
        session_start_secure();rate_limit('admin-login',6);
        $v=data();$email=strtolower(require_string($v,'email',190));$password=(string)($v['password']??'');
        $user=row('SELECT * FROM admin_users WHERE email=?',[$email]);
        if(!$user||!password_verify($password,$user['password_hash']))fail(401,'E-mail ou senha inválidos.');
        session_regenerate_id(true);$_SESSION['admin_id']=$user['id'];$_SESSION['admin_email']=$user['email'];result(['ok'=>true,'email'=>$user['email'],'csrf'=>csrf()]);
    }
    if($path==='/auth/me' && $method==='GET'){$u=require_admin();result($u+['csrf'=>csrf()]);}
    require_admin();
    if($method!=='GET')require_csrf();
    if($path==='/auth/logout' && $method==='POST'){$_SESSION=[];session_destroy();result(['ok'=>true]);}
    // Inspecao e migracao acessiveis SOMENTE ao administrador autenticado, com CSRF.
    if($path==='/schema' && $method==='GET') {
        $missing=schema_missing_columns();
        result(['schema'=>count($missing)===0?'ok':'migration_required',
                'database'=>(string)db()->query('SELECT DATABASE()')->fetchColumn(),
                'missing'=>$missing]);
    }
    if($path==='/schema/migrate' && $method==='POST') {
        $input=data();
        if(($input['backup_confirmed']??false)!==true)
            fail(422,'Confirme que fez backup do banco antes de aplicar a migracao.');
        try {
            $changes=schema_apply_migration();
        } catch(PDOException $e) {
            error_log('Campo Ferrari migration: '.$e->getMessage());
            fail(503,'Falha na atualizacao. Confira permissao ALTER TABLE no MySQL e os logs do servidor.');
        }
        $missing=schema_missing_columns();
        result(['schema'=>$missing?'migration_required':'ok',
                'changed'=>$changes, 'missing'=>$missing],$missing?503:200);
    }

    if($path==='/dashboard' && $method==='GET') {
        $today=date('Y-m-d');$counts=[];
        foreach(['pending','awaiting_payment','payment_sent','confirmed'] as $status){$r=row('SELECT COUNT(*) n FROM reservations WHERE status=?',[$status]);$counts[$status]=(int)$r['n'];}
        $counts['awaiting_payment']+=$counts['payment_sent'];unset($counts['payment_sent']);
        $counts['open_list_new']=(int)row("SELECT COUNT(*) n FROM open_list WHERE status='new'")['n'];
        $counts['suggestions_new']=(int)row("SELECT COUNT(*) n FROM suggestions WHERE status='new'")['n'];
        result(['counts'=>$counts,'upcoming'=>reservation_records("WHERE booking_date>=? AND status IN ('pending','awaiting_payment','payment_sent','confirmed') ORDER BY booking_date LIMIT 30",[$today]),'today_reservations'=>reservation_records('WHERE booking_date=?',[$today])]);
    }
    if($path==='/reservations' && $method==='GET'){ $status=(string)($_GET['status']??'');result(reservation_records($status?'WHERE status=? ORDER BY booking_date':['ORDER BY booking_date'], $status?[$status]:[]));}
    if(preg_match('#^/reservations/([A-Za-z0-9_-]+)$#',$path,$m)) {
        if($method==='DELETE') {execute('DELETE FROM reservations WHERE id=?',[$m[1]]);result(['ok'=>true]);}
        if($method==='PATCH') {
            $v=data();$status=strval_safe($v['status']??'',25);
            if(!in_array($status,['pending','awaiting_payment','payment_sent','confirmed','cancelled'],true))fail(422,'Situação inválida.');
            $r=row('SELECT booking_date,period FROM reservations WHERE id=?',[$m[1]]);if(!$r)fail(404,'Reserva inexistente.');
            db()->beginTransaction();
            try {
                lock_day($r['booking_date']);
                if(in_array($status,active_statuses(),true)){
                    $other=row("SELECT id FROM reservations WHERE booking_date=? AND period=? AND id<>? AND status IN ('pending','awaiting_payment','payment_sent','confirmed')",[$r['booking_date'],$r['period'],$m[1]]);
                    if($other)fail(409,'Já existe outra reserva neste turno.');
                    if(row('SELECT id FROM blocked_dates WHERE booking_date=?',[$r['booking_date']]) || row('SELECT id FROM open_events WHERE event_date=? AND period=?',[$r['booking_date'],$r['period']]))fail(409,'Este turno está bloqueado ou possui evento de lista aberta.');
                }
                if(array_key_exists('notes',$v))execute('UPDATE reservations SET status=?,notes=? WHERE id=?',[$status,strval_safe($v['notes'],1000),$m[1]]);
                else execute('UPDATE reservations SET status=? WHERE id=?',[$status,$m[1]]);
                db()->commit();result(['ok'=>true]);
            }catch(Throwable $e){if(db()->inTransaction())db()->rollBack();throw $e;}
        }
    }
    if($path==='/equipment-report' && $method==='GET') { $date=valid_date($_GET['date']??null,true);$out=[];foreach(catalog('equipment',false) as $eq){$used=0;foreach(periods() as $p){foreach(equipment_availability($date,$p['id']) as $e){if($e['id']===$eq['id'])$used+=$e['units_reserved'];}}$out[]=['id'=>$eq['id'],'name'=>$eq['name'],'units_available'=>$eq['units_available'],'units_reserved'=>$used,'units_free'=>max(0,$eq['units_available']-$used)];}result($out);}
    if($path==='/blocked-dates') {
        if($method==='GET')result(array_map(static fn($r)=>['id'=>$r['id'],'date'=>$r['booking_date'],'reason'=>$r['reason']],rows('SELECT * FROM blocked_dates ORDER BY booking_date')));
        if($method==='POST') { $v=data();$d=valid_date($v['date']??null);db()->beginTransaction();try{lock_day($d);if(row('SELECT id FROM reservations WHERE booking_date=? AND status IN (\'pending\',\'awaiting_payment\',\'payment_sent\',\'confirmed\')',[$d]) || row('SELECT id FROM open_events WHERE event_date=?',[$d]))fail(409,'Data com reserva ou evento existente.');execute('INSERT INTO blocked_dates (id,booking_date,reason) VALUES (?,?,?)',[id('bd'),$d,strval_safe($v['reason']??'',255)]);db()->commit();result(['ok'=>true],201);}catch(Throwable $e){if(db()->inTransaction())db()->rollBack();throw $e;}}
    }
    if(preg_match('#^/blocked-dates/([A-Za-z0-9_-]+)$#',$path,$m)&&$method==='DELETE'){execute('DELETE FROM blocked_dates WHERE id=?',[$m[1]]);result(['ok'=>true]);}
    if($path==='/open-events'){
        if($method==='GET')result(open_events(false));
        if($method==='POST'){
            $v=data();$d=valid_date($v['date']??null);
            $period=strval_safe($v['period']??'',12);
            $meta=period_details($period);
            $limit=filter_var($v['max_players']??null,FILTER_VALIDATE_INT);
            if($limit===false||$limit<1||$limit>100)fail(422,'Informe um limite de 1 a 100 participantes.');
            if($d===date('Y-m-d') && period_has_started($period))fail(422,'Este turno já começou. Escolha uma data ou turno futuro.');
            $title=strval_safe($v['title']??'Jogo de Lista Aberta',150) ?: 'Jogo de Lista Aberta';
            $notes=strval_safe($v['notes']??'',1000);
            db()->beginTransaction();
            try {
                lock_day($d);
                // Outras reservas nesta data não impedem um evento em turno livre.
                if(row('SELECT id FROM blocked_dates WHERE booking_date=?',[$d]))fail(409,'Esta data está bloqueada pelo administrador.');
                if(row("SELECT id FROM reservations WHERE booking_date=? AND period=? AND status IN ('pending','awaiting_payment','payment_sent','confirmed')",[$d,$period]))fail(409,'Já existe uma reserva de lista fechada neste turno.');
                // Mantém o limite atual de um evento de Lista Aberta por data,
                // compatível com bancos que possuem índice único em event_date.
                if(row('SELECT id FROM open_events WHERE event_date=?',[$d]))fail(409,'Já existe uma lista aberta nesta data.');
                $eventId=id('ev');
                execute('INSERT INTO open_events (id,event_date,title,notes,max_players,time_info,period) VALUES (?,?,?,?,?,?,?)',
                    [$eventId,$d,$title,$notes,$limit,$meta['time'],$period]);
                db()->commit();result(['id'=>$eventId],201);
            } catch(Throwable $e) {if(db()->inTransaction())db()->rollBack();throw $e;}
        }
    }
    if(preg_match('#^/open-events/([A-Za-z0-9_-]+)$#',$path,$m)&&$method==='DELETE'){
        $event=row('SELECT event_date FROM open_events WHERE id=?',[$m[1]]);
        if(!$event)fail(404,'Evento não encontrado.');
        db()->beginTransaction();
        try {
            lock_day($event['event_date']);
            if(row('SELECT id FROM open_list WHERE event_id=? LIMIT 1',[$m[1]]))fail(409,'Este evento já possui inscritos. Preserve os registros; entre em contato com os participantes antes de cancelar.');
            execute('DELETE FROM open_events WHERE id=?',[$m[1]]);
            db()->commit();result(['ok'=>true]);
        } catch(Throwable $e) {if(db()->inTransaction())db()->rollBack();throw $e;}
    }
    foreach(['equipment','accessories','ammo'] as $kind){
        if($path==='/'.$kind) {
            if($method==='GET')result(catalog($kind,false));
            if($method==='POST')result(catalog_save($kind,null,data()),201);
        }
        if(preg_match('#^/'. $kind .'/([A-Za-z0-9_-]+)$#',$path,$m)){
            if($method==='PUT'||$method==='PATCH')result(catalog_save($kind,$m[1],data()));
            if($method==='DELETE'){execute("UPDATE $kind SET active=0 WHERE id=?",[$m[1]]);result(['ok'=>true]);}
        }
    }
    if($path==='/settings'){
        if($method==='GET')result(settings());
        if($method==='PUT'||$method==='PATCH'){
            $v=data();$keys=['pix_key','pix_holder_name','pix_bank','pix_instructions','whatsapp_number','field_name','address','hours_info','instagram','facebook','entry_fee','deposit_percent'];
            $changes=[];$params=[];
            foreach($keys as $key)if(array_key_exists($key,$v)){
                $value=$v[$key];
                if(in_array($key,['entry_fee','deposit_percent'],true)){
                    if(!is_numeric($value)||$value<0||($key==='deposit_percent'&&$value>100)||$value>100000)fail(422,'Valor inválido.');$value=round((float)$value,2);
                }else{$max=in_array($key,['pix_instructions'],true)?1000:(in_array($key,['pix_key','address','hours_info','instagram','facebook'],true)?255:160);$value=$value===null?null:strval_safe($value,$max);}
                $changes[]="$key=?";$params[]=$value;
            }
            if($changes){$params[]=1;execute('UPDATE settings SET '.implode(',',$changes).' WHERE id=?',$params);}result(settings());
        }
    }
    foreach(['open-list'=>'open_list','suggestions'=>'suggestions'] as $slug=>$table){
        if($path==='/'.$slug && $method==='GET'){
            $items=$slug==='open-list'
                ? rows('SELECT ol.*,e.title AS event_title,e.period AS event_period,e.event_date AS event_date FROM open_list ol LEFT JOIN open_events e ON e.id=ol.event_id ORDER BY ol.created_at DESC LIMIT 500')
                : rows('SELECT * FROM suggestions ORDER BY created_at DESC LIMIT 500');
            // A coluna notes existente armazena a escolha de turno sem exigir
            // migração da base MySQL instalada em produção.
            if($slug==='open-list')foreach($items as &$item){
                $item['preferred_period']=$item['event_period']??null;
                // Campo privado: entregue os acompanhantes somente no endpoint autenticado.
                $parsed=json_decode((string)($item['participant_names']??'[]'),true);
                $item['participant_names']=is_array($parsed)?array_values(array_filter($parsed,'is_string')):[];
                if(!$item['preferred_period'] && preg_match('/^\[TURNO:(manha|tarde|noite)\](?:\r?\n|$)/',(string)($item['notes']??''),$match)){
                    $item['preferred_period']=$match[1];
                    $item['notes']=preg_replace('/^\[TURNO:(manha|tarde|noite)\](?:\r?\n|$)/','',(string)$item['notes'],1);
                }
            }
            unset($item);
            result($items);
        }
        if(preg_match('#^/'.preg_quote($slug,'#').'/([A-Za-z0-9_-]+)$#',$path,$m)){
            if($method==='PATCH'){
                $v=data();
                if($table==='open_list' && array_key_exists('public_names_consent',$v)) {
                    if(!is_bool($v['public_names_consent']))fail(422,'Valor de autorização inválido.');
                    if($v['public_names_consent']===true && ($v['consent_confirmed']??false)!==true)
                        fail(422,'Confirme que a autorização de todos foi verificada, incluindo responsáveis legais quando houver menores.');
                    if(!column_exists('open_list','public_names_consent'))fail(503,'Migração SQL pendente.');
                    if(execute('UPDATE open_list SET public_names_consent=? WHERE id=?',[$v['public_names_consent']?1:0,$m[1]])===0 && !row('SELECT id FROM open_list WHERE id=?',[$m[1]]))fail(404,'Inscrição não encontrada.');
                    result(['ok'=>true]);
                }
                $status=strval_safe($v['status']??'',20);
                if(!in_array($status,['new','contacted','resolved','archived'],true))fail(422,'Situação inválida.');
                if(execute("UPDATE $table SET status=? WHERE id=?",[$status,$m[1]])===0 && !row("SELECT id FROM $table WHERE id=?",[$m[1]]))fail(404,'Registro não encontrado.');
                result(['ok'=>true]);
            }
            if($method==='DELETE'){
                // Rota exclusivamente administrativa: sessão + token CSRF são
                // exigidos acima. Usa parâmetros vinculados, sem SQL dinâmico
                // recebido do visitante (as tabelas são fixas nesta lista).
                if($table==='open_list'){
                    db()->beginTransaction();
                    try {
                        $entry=row('SELECT ol.id,e.event_date FROM open_list ol LEFT JOIN open_events e ON e.id=ol.event_id WHERE ol.id=?',[$m[1]]);
                        if(!$entry)fail(404,'Inscrição não encontrada.');
                        // Mesmo lock usado na inscrição para não ocorrer corrida
                        // entre liberar vagas e cadastrar outro participante.
                        if(!empty($entry['event_date']))lock_day($entry['event_date']);
                        execute('DELETE FROM open_list WHERE id=?',[$m[1]]);
                        db()->commit();
                    }catch(Throwable $e){if(db()->inTransaction())db()->rollBack();throw $e;}
                }else{
                    if(execute('DELETE FROM suggestions WHERE id=?',[$m[1]])===0)fail(404,'Sugestão não encontrada.');
                }
                result(['ok'=>true,'deleted'=>1]);
            }
        }
    }
    fail(404,'Rota administrativa não encontrada.');
}
/** Somente endpoints autenticados retornam a relação completa de jogadores. */
function reservation_records(string|array $suffix, array $args=[]):array {
    $suffix=is_array($suffix)?$suffix[0]:$suffix;
    $records=rows('SELECT * FROM reservations '.$suffix,$args);
    $namesById=[];
    if($records && column_exists('reservation_players','player_name')) {
        $ids=array_column($records,'id');
        $marks=implode(',',array_fill(0,count($ids),'?'));
        foreach(rows("SELECT reservation_id,player_number,player_name FROM reservation_players WHERE reservation_id IN ($marks) ORDER BY player_number",$ids) as $p){
            $namesById[$p['reservation_id']][]=['number'=>(int)$p['player_number'],'name'=>(string)($p['player_name']??'')];
        }
    }
    return array_map(static function($r)use($namesById){
        $r['date']=$r['booking_date'];unset($r['booking_date']);
        $r['total']=(float)$r['total'];$r['deposit_amount']=(float)$r['deposit_amount'];
        $r['players']=$namesById[$r['id']]??[];
        return $r;
    },$records);
}
function period_details(string $period):array {
    foreach(periods() as $item) if($item['id']===$period)return $item;
    fail(422,'Selecione um turno válido: manhã, tarde ou noite.');
}
function period_has_started(string $period):bool {
    $start=['manha'=>'08:00','tarde'=>'13:30','noite'=>'19:00'];
    return isset($start[$period]) && date('H:i') >= $start[$period];
}
/**
 * Nome curto para visualização pública. Nome completo e telefone são privados.
 * O consentimento para exibir acompanhantes é registrado separadamente.
 */
function public_participant_name(string $fullName):string {
    $parts=preg_split('/\s+/u',trim($fullName),-1,PREG_SPLIT_NO_EMPTY);
    if(!$parts)return 'Participante';
    if(count($parts)===1)return $parts[0];
    preg_match('/^./u',$parts[count($parts)-1],$initial);
    return $parts[0].' '.($initial[0]??'').'.';
}
function open_events(bool $future=true):array {
    $args=$future?[date('Y-m-d')]:[];
    $sql="SELECT e.id,e.event_date AS date,e.title,e.notes,e.max_players,e.time_info,e.period,
        (SELECT COALESCE(SUM(ol.people_count),0) FROM open_list ol
         WHERE ol.event_id=e.id AND ol.status IN ('new','contacted','resolved')) AS registered_people
        FROM open_events e".($future?' WHERE e.event_date >= ?':'').' ORDER BY e.event_date,e.time_info';
    $events=rows($sql,$args);
    // A API pública usa somente nomes abreviados e nunca publica contato,
    // observações ou nomes completos do banco. As inscrições anteriores à
    // autorização continuam anônimas quanto aos acompanhantes.
    $participants=[];
    if($events){
        $ids=array_column($events,'id');
        $marks=implode(',',array_fill(0,count($ids),'?'));
        // Compatibilidade na implantação: antes de aplicar o SQL, a listagem
        // ainda funciona e apenas não mostra os acompanhantes.
        $hasConsentColumn=column_exists('open_list','public_names_consent')
            && column_exists('open_list','participant_names');
        $extraColumns=$hasConsentColumn?',participant_names,public_names_consent':'';
        $list=rows("SELECT event_id,name,people_count".$extraColumns." FROM open_list
            WHERE event_id IN ($marks) AND status IN ('new','contacted','resolved')
            ORDER BY created_at,id",$ids);
        foreach($list as $entry){
            $display=public_participant_name((string)$entry['name']);
            $people=max(1,(int)$entry['people_count']);
            $publicCompanions=[];
            if($hasConsentColumn && (int)($entry['public_names_consent']??0)===1){
                $names=json_decode((string)($entry['participant_names']??'[]'),true);
                if(is_array($names)){
                    foreach(array_slice($names,0,$people-1) as $name){
                        if(is_string($name) && trim($name)!=='')
                            $publicCompanions[]=public_participant_name($name);
                    }
                }
            }
            $participants[$entry['event_id']][]=[
                'display_name'=>$display,
                'people_count'=>$people,
                'companion_names'=>$publicCompanions,
            ];
        }
    }
    foreach($events as &$event){
        $event['participants']=$participants[$event['id']]??[];
        $meta=null;
        foreach(periods() as $p)if($p['id']===$event['period']){$meta=$p;break;}
        $event['period_label']=$meta['label']??'Horário definido pelo organizador';
        $event['period_time']=$meta['time']??($event['time_info']??'A confirmar');
        $event['registered_people']=(int)$event['registered_people'];
        $event['max_players']=$event['max_players']===null?null:(int)$event['max_players'];
        $event['remaining_places']=$event['max_players']===null?null:max(0,$event['max_players']-$event['registered_people']);
        $event['is_full']=$event['remaining_places']!==null && $event['remaining_places']<=0;
        $event['has_started']=$event['date']<date('Y-m-d') ||
            ($event['date']===date('Y-m-d') && $meta!==null && period_has_started($event['period']));
        $event['can_register']=!$event['is_full'] && !$event['has_started'];
    }
    unset($event);
    return $events;
}

function catalog_save(string $kind,?string $productId,array $input):array {
    $name=require_string($input,'name',150);$price=$input['price']??null;
    if(!is_numeric($price)||$price<0||$price>100000)fail(422,'Preço inválido.');
    $fields=['name'=>$name,'price'=>round((float)$price,2),'active'=>!empty($input['active'])?1:0];
    if(!array_key_exists('active',$input))$fields['active']=1;
    if($kind==='equipment'){$fields['ammo']=max(0,min(200000,(int)($input['ammo']??0)));$fields['units_available']=max(0,min(1000,(int)($input['units_available']??1)));$fields['sort_order']=(int)($input['order']??0);}
    if($kind==='accessories')$fields['sort_order']=(int)($input['order']??0);
    if($kind==='ammo')$fields['ammo_count']=max(0,min(200000,(int)($input['ammo_count']??0)));
    if($productId){$s=implode(',',array_map(static fn($key)=>"$key=?",array_keys($fields)));execute("UPDATE $kind SET $s WHERE id=?",[...array_values($fields),$productId]);}
    else {$productId=id(substr($kind,0,2));$all=['id'=>$productId,...$fields];execute('INSERT INTO '.$kind.' ('.implode(',',array_keys($all)).') VALUES ('.implode(',',array_fill(0,count($all),'?')).')',array_values($all));}
    return row("SELECT * FROM $kind WHERE id=?",[$productId])??[];
}
function initial_admin_setup(string $method):never {
    if ($method === 'GET') {
        $r=row('SELECT COUNT(*) AS n FROM admin_users');
        result(['setup_required'=>(int)$r['n']===0]);
    }
    if ($method !== 'POST') fail(405,'Método não permitido.');
    rate_limit('admin-setup',5);
    $cfg=require __DIR__.'/config.local.php';
    $key=(string)($cfg['setup_key']??'');
    if (strlen($key)<32) fail(503,'Configure uma chave de instalação forte no servidor.');
    $v=data();
    if (!hash_equals($key,(string)($v['setup_key']??''))) fail(403,'Chave de instalação inválida.');
    $email=strtolower(require_string($v,'email',190));
    if (!filter_var($email,FILTER_VALIDATE_EMAIL)) fail(422,'E-mail inválido.');
    $password=(string)($v['password']??'');
    if (strlen($password)<12 || strlen($password)>256) fail(422,'Use senha com 12 a 256 caracteres.');
    $pdo=db();
    $lock=$pdo->query("SELECT GET_LOCK('cf_setup_admin_once', 5)")->fetchColumn();
    if ((int)$lock!==1) fail(409,'Instalação em andamento. Tente novamente.');
    try {
        $existing=(int)$pdo->query('SELECT COUNT(*) FROM admin_users')->fetchColumn();
        if ($existing!==0) fail(409,'Administrador já configurado.');
        $hash=password_hash($password,PASSWORD_DEFAULT);
        execute('INSERT INTO admin_users (email,display_name,password_hash) VALUES (?,?,?)',[$email,'Administrador',$hash]);
    } finally {
        $pdo->query("SELECT RELEASE_LOCK('cf_setup_admin_once')");
    }
    result(['ok'=>true,'message'=>'Administrador criado. Entre com seu e-mail e senha.'],201);
}
function route(string $method,string $path):void {
    if($path==='/admin/setup' && in_array($method,['GET','POST'],true)) initial_admin_setup($method);
    if($path==='/health' && $method==='GET'){
        // Sem expor senha, usuário, host ou dados pessoais, verifica se o banco
        // e as duas colunas necessárias à versão publicada estão disponíveis.
        db()->query('SELECT 1');
        $updated=count(schema_missing_columns())===0;
        result(['status'=>$updated?'ok':'degraded',
                'database'=>'connected',
                'schema'=>$updated?'ok':'migration_required',
                'time'=>date('c')],$updated?200:503);
    }
    if($path==='/' && $method==='GET')result(['message'=>'Campo Ferrari Airsoft API PHP/MySQL']);
    if($path==='/site/config' && $method==='GET')result(['booking_app_url'=>'']);
    if(str_starts_with($path,'/admin/'))admin_route($method,substr($path,6));
    if($path==='/settings/public' && $method==='GET'){
        $s=settings();$allowed=['entry_fee','deposit_percent','pix_key','pix_holder_name','pix_bank','pix_instructions','whatsapp_number','field_name','address','hours_info','instagram','facebook'];result(array_intersect_key($s,array_flip($allowed)));
    }
    foreach(['equipment','accessories','ammo'] as $kind) if($path==='/'.$kind && $method==='GET')result(catalog($kind));
    if($path==='/periods' && $method==='GET')result(periods());
    if($path==='/day-periods' && $method==='GET')result(available_periods(valid_date($_GET['date']??null)));
    if($path==='/availability' && $method==='GET'){
        $year=filter_var($_GET['year']??null,FILTER_VALIDATE_INT);$month=filter_var($_GET['month']??null,FILTER_VALIDATE_INT);
        if(!$year||!$month||$year<2020||$year>2100||$month<1||$month>12)fail(422,'Mês ou ano inválido.');
        $n=cal_days_in_month(CAL_GREGORIAN,$month,$year);$res=[];
        for($d=1;$d<=$n;$d++){
            $date=sprintf('%04d-%02d-%02d',$year,$month,$d);
            $ps=available_periods($date);$statuses=array_column($ps,'status');
            $hasOpenEvent=in_array('open_event',$statuses,true);
            $status=in_array('available',$statuses,true)?'available':($hasOpenEvent?'open_event':(in_array('blocked',$statuses,true)?'blocked':'full'));
            // has_open_event sinaliza a Lista Aberta mesmo quando o dia ainda
            // possui turnos disponíveis para reservas de Lista Fechada.
            $rec=['date'=>$date,'status'=>$status,'has_open_event'=>$hasOpenEvent];
            if($hasOpenEvent){
                $ev=row('SELECT title FROM open_events WHERE event_date=? LIMIT 1',[$date]);
                $rec['event_title']=$ev['title']??'Jogo de Lista Aberta';
            }
            $res[]=$rec;
        }result($res);
    }
    if($path==='/equipment/availability' && $method==='GET'){
        $day=valid_date($_GET['date']??null);$period=strval_safe($_GET['period']??'',12);if(!in_array($period,['manha','tarde','noite'],true))fail(422,'Turno inválido.');result(equipment_availability($day,$period));
    }
    if($path==='/reservations/preview' && $method==='POST'){rate_limit('preview',40);result(calc(data()));}
    if($path==='/reservations' && $method==='POST') result(save_reservation(data()),201);
    if($path==='/open-events' && $method==='GET')result(open_events());
    if($path==='/open-list' && $method==='POST'){
        $v=data();
        if(($v['responsible_adult']??false)!==true)fail(422,'É necessário um responsável maior de idade.');
        rate_limit('open-list');
        $eventId=require_string($v,'event_id',36);
        if(!preg_match('/^[A-Za-z0-9_-]+$/',$eventId))fail(422,'Evento inválido.');
        $name=require_string($v,'name');
        // Armazenar telefone normalizado evita cadastros repetidos usando máscaras diferentes.
        $wp=preg_replace('/\D/','',phone($v['whatsapp']??null));
        $people=filter_var($v['people_count']??null,FILTER_VALIDATE_INT);
        if($people===false||$people<1||$people>100)fail(422,'Informe entre 1 e 100 participantes.');
        // A função também verifica a contagem no servidor; responsável = pessoa 1.
        $namesJson=validate_open_list_names($v['participant_names']??null,(int)$people);
        // A pessoa responsável confirma autorização para divulgar APENAS os
        // nomes abreviados dos integrantes. Menores precisam da autorização
        // de seus responsáveis legais. O aceite deve ser explícito.
        // Divulgação opcional: não condicione a inscrição à publicidade dos nomes.
        $publicNamesConsent=($v['public_names_consent']??false)===true;
        $notes=strval_safe($v['notes']??'',1000);
        // Falha explícita caso o administrador ainda não tenha aplicado a migração.
        if(!column_exists('open_list','participant_names'))
            fail(503,'Atualização do banco pendente. Solicite ao administrador a migração SQL dos nomes dos participantes.');
        if(!column_exists('open_list','public_names_consent'))
            fail(503,'A exibição autorizada dos nomes requer aplicar a migração SQL antes de novas inscrições.');
        // O navegador NÃO cria eventos ou define horários: tudo vem do evento
        // publicado na área autenticada. O bloqueio serializa inscrições
        // simultâneas para não ultrapassar o limite de vagas.
        $reference=row('SELECT event_date FROM open_events WHERE id=?',[$eventId]);
        if(!$reference)fail(404,'Este evento não existe mais.');
        $day=valid_date($reference['event_date']);
        db()->beginTransaction();
        try {
            lock_day($day);
            $event=row('SELECT id,event_date,period,max_players,title FROM open_events WHERE id=? FOR UPDATE',[$eventId]);
            if(!$event || $event['event_date']!==$day)fail(409,'O evento foi alterado. Atualize a lista.');
            if($day===date('Y-m-d') && in_array($event['period'],['manha','tarde','noite'],true) && period_has_started($event['period']))fail(409,'As inscrições para esse turno encerraram.');
            $existing=row("SELECT id FROM open_list WHERE event_id=? AND whatsapp=? AND status IN ('new','contacted','resolved') LIMIT 1",[$eventId,$wp]);
            if($existing)fail(409,'Este WhatsApp já está inscrito nesse evento. Fale com a equipe para alterar a inscrição.');
            if($event['max_players']!==null){
                $taken=row("SELECT COALESCE(SUM(people_count),0) AS total FROM open_list WHERE event_id=? AND status IN ('new','contacted','resolved')",[$eventId]);
                if((int)$taken['total']+$people>(int)$event['max_players'])fail(409,'Não há vagas suficientes para essa quantidade de participantes.');
            }
            $newId=id('ol');
            execute('INSERT INTO open_list (id,event_id,name,whatsapp,people_count,participant_names,public_names_consent,preferred_date,notes) VALUES (?,?,?,?,?,?,?,?,?)',
                [$newId,$eventId,$name,$wp,$people,$namesJson,$publicNamesConsent?1:0,$day,$notes]);
            db()->commit();
            result(['id'=>$newId,'event_id'=>$eventId,'event_title'=>$event['title'],'date'=>$day,'status'=>'new'],201);
        } catch(Throwable $e) {if(db()->inTransaction())db()->rollBack();throw $e;}
    }
    if($path==='/suggestions' && $method==='POST'){
        rate_limit('suggestions');$v=data();$name=strval_safe($v['name']??'',120);$wp=strval_safe($v['whatsapp']??'',40);$msg=require_string($v,'message',2000);
        $rating=$v['rating']??null;if($rating!==null && (!is_int($rating)||$rating<1||$rating>5))fail(422,'Avaliação inválida.');
        $id=id('sg');execute('INSERT INTO suggestions (id,name,whatsapp,message,rating) VALUES (?,?,?,?,?)',[$id,$name,$wp,$msg,$rating]);result(['id'=>$id,'status'=>'new'],201);
    }
    fail(404,'Rota não encontrada.');
}
