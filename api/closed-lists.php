<?php
declare(strict_types=1);

/** Requests stay outside the occupied calendar until an administrator approves them. */
function closed_lists_ready(bool $refresh=false): bool {
    static $ready=null;
    if($refresh || $ready===null) {
        $ready=(bool)db()->query("SHOW TABLES LIKE 'closed_list_approvals'")->fetchColumn()
            && (bool)db()->query("SHOW TABLES LIKE 'closed_list_participants'")->fetchColumn();
    }
    return $ready;
}
function require_closed_lists(): void {
    if(!closed_lists_ready())fail(503,'Atualize o banco no painel: Configurações > Manutenção do MySQL. A aprovação de listas fechadas ainda não está instalada.');
}
/** Legacy bookings have no approval row and retain their previous calendar behavior. */
function approved_reservation_sql(string $alias='reservations'): string {
    if(!in_array($alias,['reservations','r'],true))throw new InvalidArgumentException('Alias inválido.');
    return closed_lists_ready()
        ? " AND NOT EXISTS (SELECT 1 FROM closed_list_approvals ca WHERE ca.reservation_id=$alias.id AND ca.approval_status<>'approved')"
        : '';
}
function closed_registration_open(array $reservation): bool {
    if(($reservation['approval_status']??'')!=='approved' || !in_array($reservation['status']??'',active_statuses(),true))return false;
    $day=(string)$reservation['booking_date'];
    if($day<date('Y-m-d'))return false;
    $periods=reservation_period_ids($reservation);
    // Registration closes when the first selected session starts.
    return $day>date('Y-m-d') || !period_has_started($periods[0]);
}
function closed_period_label(array $periodIds): string {
    $labels=array_column(periods(),'label','id');
    return implode(' + ',array_map(static fn($p)=>$labels[$p]??$p,$periodIds));
}
function closed_invitation_record(string $token,bool $lock=false): array {
    require_closed_lists();
    if(!preg_match('/^[a-f0-9]{64}$/D',$token))fail(404,'Convite não encontrado ou não disponível.');
    $record=row("SELECT r.*, a.approval_status FROM closed_list_approvals a JOIN reservations r ON r.id=a.reservation_id WHERE a.invitation_token=? AND a.approval_status='approved'".($lock?' FOR UPDATE':''),[$token]);
    if(!$record)fail(404,'Convite não encontrado ou não disponível.');
    if(!in_array($record['status'],active_statuses(),true))fail(410,'Este convite foi encerrado. Entre em contato com o organizador.');
    return $record;
}
/** O convite não autoriza acesso a dados privados nem edição sem chave pessoal. */
function closed_invitation_features_ready(): bool {
    static $ready=null;
    if($ready===null){
        require_closed_lists();
        $ready=column_exists('closed_list_participants','public_name_consent')
            && column_exists('closed_list_participants','edit_token_hash');
    }
    return $ready;
}
function closed_invitation_full_consent_ready(): bool {
    static $ready=null;
    if($ready===null)$ready=column_exists('closed_list_participants','public_full_name_consent');
    return $ready;
}
function closed_invitation_short_name(string $name): string {
    $parts=preg_split('/\s+/u',trim($name),-1,PREG_SPLIT_NO_EMPTY)?:[];
    if(!$parts)return 'Jogador confirmado';
    $first=$parts[0];
    if(count($parts)===1)return $first;
    $last=$parts[count($parts)-1];
    $initial=function_exists('mb_substr')?mb_substr($last,0,1,'UTF-8'):substr($last,0,1);
    return $first.' '.(function_exists('mb_strtoupper')?mb_strtoupper($initial,'UTF-8'):strtoupper($initial)).'.';
}
function closed_invitation_public(string $token): array {
    $r=closed_invitation_record($token);
    $selected=reservation_period_ids($r);
    $features=closed_invitation_features_ready();
    $fullConsent=$features && closed_invitation_full_consent_ready();
    $people=rows('SELECT id'.($features?',name,public_name_consent'.($fullConsent?',public_full_name_consent':''):'').' FROM closed_list_participants WHERE reservation_id=? ORDER BY created_at,id',[$r['id']]);
    $count=count($people);
    $participants=[];
    foreach($people as $index=>$person) {
        $visible=$features && (int)$person['public_name_consent']===1;
        $showFull=$visible && $fullConsent && (int)$person['public_full_name_consent']===1;
        $participants[]=[
            'id'=>$person['id'],
            'display_name'=>$showFull?(string)$person['name']:($visible?closed_invitation_short_name((string)$person['name']):'Jogador confirmado'),
            'name_visible'=>$visible,
            'number'=>$index+1,
        ];
    }
    return ['reservation_id'=>$r['id'],'date'=>$r['booking_date'],'periods'=>$selected,
        'period_label'=>closed_period_label($selected),'player_count'=>(int)$r['player_count'],
        'registered_people'=>$count,'remaining_spots'=>max(0,(int)$r['player_count']-$count),
        'participants'=>$participants,'edit_available'=>$features,'changes_open'=>closed_registration_open($r),
        'status'=>'approved','registration_open'=>closed_registration_open($r) && $count<(int)$r['player_count']];
}
function closed_invitation_register(string $token,array $input): array {
    require_closed_lists();
    if(($input['responsible_adult']??false)!==true || ($input['privacy_consent']??false)!==true)
        fail(422,'Confirme que é maior de 18 anos e aceita a Política de Privacidade.');
    $name=require_string($input,'name');
    if((function_exists('mb_strlen')?mb_strlen($name):strlen($name))<2)fail(422,'Informe seu nome completo.');
    $whatsapp=phone($input['whatsapp']??null);
    $showName=($input['public_name_consent']??false)===true;
    rate_limit('closed-invitation-register',20);
    db()->beginTransaction();
    try {
        $r=closed_invitation_record($token,true);
        if(!closed_registration_open($r))fail(410,'As inscrições para este jogo foram encerradas.');
        if(row('SELECT id FROM closed_list_participants WHERE reservation_id=? AND whatsapp=?',[$r['id'],$whatsapp]))
            fail(409,'Este WhatsApp já está cadastrado neste jogo. Abra seu link individual de edição para corrigir seus dados.');
        $count=(int)row('SELECT COUNT(*) AS n FROM closed_list_participants WHERE reservation_id=?',[$r['id']])['n'];
        if($count>=(int)$r['player_count'])fail(409,'A lista está completa. Fale com o organizador.');
        $participantId=id('cp');
        $features=closed_invitation_features_ready();
        $fullConsent=$features && closed_invitation_full_consent_ready();
        $editKey=null;
        if($features){
            $editKey=bin2hex(random_bytes(32));
            if($fullConsent){
                execute('INSERT INTO closed_list_participants (id,reservation_id,name,whatsapp,privacy_consent,public_name_consent,public_full_name_consent,edit_token_hash) VALUES (?,?,?,?,1,?,?,?)',
                    [$participantId,$r['id'],$name,$whatsapp,$showName?1:0,$showName?1:0,hash('sha256',$editKey)]);
            } else {
                execute('INSERT INTO closed_list_participants (id,reservation_id,name,whatsapp,privacy_consent,public_name_consent,edit_token_hash) VALUES (?,?,?,?,1,?,?)',
                    [$participantId,$r['id'],$name,$whatsapp,$showName?1:0,hash('sha256',$editKey)]);
            }
        } else {
            // Existing registrations keep working until the administrator applies the additive migration.
            execute('INSERT INTO closed_list_participants (id,reservation_id,name,whatsapp,privacy_consent) VALUES (?,?,?,?,1)',
                [$participantId,$r['id'],$name,$whatsapp]);
        }
        db()->commit();
        return ['id'=>$participantId,'status'=>'registered','date'=>$r['booking_date'],
            'period_label'=>closed_period_label(reservation_period_ids($r)),
            'edit_key'=>$editKey,'edit_available'=>$features];
    } catch(Throwable $e) {if(db()->inTransaction())db()->rollBack();throw $e;}
}
/** Edit capability is known only to the browser that registered the participant. */
function closed_invitation_update_participant(string $token,string $participantId,array $input): array {
    require_closed_lists();
    if(!closed_invitation_features_ready())fail(503,'O administrador precisa atualizar o MySQL para habilitar a edição dos nomes.');
    if(!preg_match('/^cp_[a-f0-9]{16}$/D',$participantId))fail(404,'Cadastro não encontrado.');
    $key=(string)($input['edit_key']??'');
    if(!preg_match('/^[a-f0-9]{64}$/D',$key))fail(403,'Autorização de edição inválida.');
    $name=require_string($input,'name');
    $length=function_exists('mb_strlen')?mb_strlen($name):strlen($name);
    if($length<2 || $length>120)fail(422,'Informe um nome de 2 a 120 caracteres.');
    $showName=($input['public_name_consent']??false)===true;
    rate_limit('closed-invitation-name-update',20);
    db()->beginTransaction();
    try {
        $r=closed_invitation_record($token,true);
        if(!closed_registration_open($r))fail(410,'O prazo para alterar nomes foi encerrado. Fale com o organizador.');
        $person=row('SELECT id,edit_token_hash FROM closed_list_participants WHERE id=? AND reservation_id=? FOR UPDATE',[$participantId,$r['id']]);
        if(!$person || empty($person['edit_token_hash']) || !hash_equals((string)$person['edit_token_hash'],hash('sha256',$key)))
            fail(403,'Link pessoal inválido. Use o mesmo aparelho do cadastro ou abra seu link individual de edição.');
        if(closed_invitation_full_consent_ready()){
            execute('UPDATE closed_list_participants SET name=?,public_name_consent=?,public_full_name_consent=? WHERE id=? AND reservation_id=?',
                [$name,$showName?1:0,$showName?1:0,$participantId,$r['id']]);
        } else {
            execute('UPDATE closed_list_participants SET name=?,public_name_consent=? WHERE id=? AND reservation_id=?',
                [$name,$showName?1:0,$participantId,$r['id']]);
        }
        db()->commit();
        return ['status'=>'updated','id'=>$participantId];
    } catch(Throwable $e) {if(db()->inTransaction())db()->rollBack();throw $e;}
}
/** Recupera apenas os próprios dados, usando a chave individual (nunca devolve WhatsApp). */
function closed_invitation_verify_edit_key(string $token,string $participantId,array $input): array {
    if(!closed_invitation_features_ready())fail(503,'Atualize o MySQL para permitir edições.');
    $key=(string)($input['edit_key']??'');
    if(!preg_match('/^cp_[a-f0-9]{16}$/D',$participantId) || !preg_match('/^[a-f0-9]{64}$/D',$key))fail(403,'Link de edição inválido.');
    rate_limit('closed-invitation-verify-edit',20);
    $r=closed_invitation_record($token);
    $select='id,name,public_name_consent,edit_token_hash'.(closed_invitation_full_consent_ready()?',public_full_name_consent':'');
    $person=row("SELECT $select FROM closed_list_participants WHERE reservation_id=? AND id=?",[$r['id'],$participantId]);
    if(!$person || !is_string($person['edit_token_hash']) || !hash_equals($person['edit_token_hash'],hash('sha256',$key)))
        fail(403,'Link de edição inválido. Confira seu link particular salvo após a inscrição.');
    return ['id'=>$person['id'],'name'=>$person['name'],
        'public_name_consent'=>closed_invitation_full_consent_ready() && (int)$person['public_full_name_consent']===1,
        'changes_open'=>closed_registration_open($r)];
}
/** Admin autenticado gera um link individual. Uma nova geração invalida o link anterior. */
function closed_invitation_issue_edit_link(string $reservationId,string $participantId): array {
    require_closed_lists();
    if(!closed_invitation_features_ready())fail(503,'Atualize o MySQL antes de gerar links individuais.');
    $row=row("SELECT r.*,a.invitation_token,a.approval_status FROM reservations r JOIN closed_list_approvals a ON a.reservation_id=r.id WHERE r.id=? AND a.approval_status='approved'",[$reservationId]);
    if(!$row || empty($row['invitation_token']))fail(404,'Convite aprovado não encontrado.');
    if(!closed_registration_open($row))fail(410,'A edição está encerrada para esta partida.');
    $person=row('SELECT id FROM closed_list_participants WHERE reservation_id=? AND id=?',[$reservationId,$participantId]);
    if(!$person)fail(404,'Jogador não encontrado.');
    $key=bin2hex(random_bytes(32));
    execute('UPDATE closed_list_participants SET edit_token_hash=? WHERE reservation_id=? AND id=?',
        [hash('sha256',$key),$reservationId,$participantId]);
    return ['id'=>$participantId,'edit_path'=>'/convite.html#token='.$row['invitation_token'].'&player='.$participantId.'&edit='.$key];
}
/** Rebuild only the server-stored selection; no browser-supplied price or stock. */
function closed_approval_input(array $r): array {
    $input=['modality'=>$r['request_kind']??'lista_fechada','date'=>$r['booking_date'],'periods'=>reservation_period_ids($r),
        'player_count'=>(int)$r['player_count'],'players'=>rows('SELECT equipment_id FROM reservation_players WHERE reservation_id=? ORDER BY player_number',[$r['id']]),
        'equipment_selections'=>[],'accessory_selections'=>[],'ammo_selections'=>[]];
    $fields=['equipment'=>'equipment_selections','accessory'=>'accessory_selections','ammo'=>'ammo_selections'];
    foreach(rows('SELECT item_type,product_id,qty FROM reservation_items WHERE reservation_id=?',[$r['id']]) as $item){
        if(isset($fields[$item['item_type']]))$input[$fields[$item['item_type']]][]=['id'=>$item['product_id'],'qty'=>(int)$item['qty']];
    }
    return $input;
}
function closed_approval_decide(string $rid,array $input): array {
    require_closed_lists();
    $decision=$input['decision']??'';
    if(!in_array($decision,['approve','reject'],true))fail(422,'Escolha aprovar ou recusar a solicitação.');
    $reason=strval_safe($input['reason']??'',1000);
    $reference=row('SELECT booking_date FROM reservations WHERE id=?',[$rid]);
    if(!$reference)fail(404,'Solicitação não encontrada.');
    db()->beginTransaction();
    try {
        // Same calendar mutex used by booking, open events and blocked dates.
        lock_day($reference['booking_date']);
        $r=row('SELECT r.*,a.approval_status,a.invitation_token,a.request_kind FROM reservations r JOIN closed_list_approvals a ON a.reservation_id=r.id WHERE r.id=? FOR UPDATE',[$rid]);
        if(!$r)fail(409,'Esta reserva é anterior ao fluxo de aprovação.');
        if($r['booking_date']!==$reference['booking_date'])fail(409,'A data foi alterada. Atualize a solicitação.');
        if($r['approval_status']==='approved' && $decision==='approve') {
            db()->commit();
            return reservation_records('WHERE id=? LIMIT 1',[$rid])[0];
        }
        if($r['approval_status']!=='pending')fail(409,'Esta solicitação já foi analisada.');
        if($decision==='approve') {
            // Pending approvals are excluded from slot/stock queries, including this one.
            calc(closed_approval_input($r));
            $token=bin2hex(random_bytes(32));
            execute("UPDATE closed_list_approvals SET approval_status='approved',invitation_token=?,approval_reason=?,reviewed_at=NOW() WHERE reservation_id=?",[$token,$reason,$rid]);
            execute("UPDATE reservations SET status=? WHERE id=?",[($r['request_kind']??'')==='evento_fechado'?'confirmed':'awaiting_payment',$rid]);
        } else {
            execute("UPDATE closed_list_approvals SET approval_status='rejected',invitation_token=NULL,approval_reason=?,reviewed_at=NOW() WHERE reservation_id=?",[$reason,$rid]);
            execute("UPDATE reservations SET status='cancelled' WHERE id=?",[$rid]);
        }
        db()->commit();
        return reservation_records('WHERE id=? LIMIT 1',[$rid])[0];
    } catch(Throwable $e) {if(db()->inTransaction())db()->rollBack();throw $e;}
}

/**
 * Recupera convites de reservas antigas já confirmadas, sem alterar a reserva.
 * Exclusivo do administrador autenticado + CSRF; POST explicito, nunca GET.
 * Também recupera aprovacao já registrada caso falte apenas o token.
 */
function closed_invitation_ensure(string $rid): array {
    require_closed_lists();
    $reference=row('SELECT booking_date FROM reservations WHERE id=?',[$rid]);
    if(!$reference)fail(404,'Reserva não encontrada.');
    db()->beginTransaction();
    try {
        lock_day($reference['booking_date']);
        $r=row('SELECT * FROM reservations WHERE id=? FOR UPDATE',[$rid]);
        if(!$r)fail(404,'Reserva não encontrada.');
        if($r['booking_date']!==$reference['booking_date'])fail(409,'A data foi alterada. Atualize a reserva.');
        $approval=row('SELECT approval_status,invitation_token FROM closed_list_approvals WHERE reservation_id=? FOR UPDATE',[$rid]);
        if($approval && $approval['approval_status']!=='approved')
            fail(409,'Esta solicitação ainda não foi aprovada. Utilize a opção Aprovar no painel.');
        if(!$approval && $r['status']==='pending')
            fail(409,'Esta reserva antiga ainda está pendente. Confirme a situação antes de gerar o convite.');
        if(!closed_registration_open(array_merge($r,['approval_status'=>'approved'])))
            fail(409,'O cadastro por convite não pode ser aberto: a reserva foi cancelada ou a data/turno já passou.');
        if($approval && !empty($approval['invitation_token'])) {
            // Operação idempotente: nunca substitui um convite compartilhado.
            db()->commit();
            return reservation_records('WHERE id=? LIMIT 1',[$rid])[0];
        }
        $token=bin2hex(random_bytes(32));
        if($approval) {
            execute("UPDATE closed_list_approvals SET invitation_token=?,reviewed_at=COALESCE(reviewed_at,NOW()) WHERE reservation_id=? AND approval_status='approved'",[$token,$rid]);
        } else {
            // Registros anteriores ao fluxo novo já ocupam data/estoque;
            // nenhuma nova reserva e nenhuma segunda cobrança são criadas.
            execute("INSERT INTO closed_list_approvals (reservation_id,approval_status,request_kind,invitation_token,reviewed_at) VALUES (?,'approved','lista_fechada',?,NOW())",[$rid,$token]);
        }
        db()->commit();
        return reservation_records('WHERE id=? LIMIT 1',[$rid])[0];
    } catch(Throwable $e) {if(db()->inTransaction())db()->rollBack();throw $e;}
}

/**
 * Atualiza a visualização administrativa dos nomes a partir do convite.
 * Não reescreve reservation_players nem altera equipamento/estoque:
 * cada cadastro no convite ocupa a próxima posição de reserva, por ordem
 * de inscrição. O vínculo é visual, não uma alteração de dados financeiros.
 * Os participantes podem corrigir nomes pelo token individual; assim que
 * o painel recarregar, a versão mais recente do cadastro prevalece.
 */
function closed_admin_roster_with_invite_names(array $reservation): array {
    $invited=$reservation['invite_registrations']??[];
    if(!$invited || !is_array($invited))return $reservation;
    $players=is_array($reservation['players']??null)?$reservation['players']:[];
    $capacity=max(0,(int)($reservation['player_count']??0));
    foreach($invited as $index=>$entry){
        if($index>=$capacity)break;
        $name=trim((string)($entry['name']??''));
        if($name==='')continue;
        if(!isset($players[$index])){
            $players[$index]=[
                'number'=>$index+1,
                'name'=>$name,
                'equipment_id'=>null,
                'equipment_name'=>null,
            ];
        } else {
            $players[$index]['name']=$name;
        }
        $players[$index]['registered_by_invitation']=true;
    }
    $reservation['players']=$players;
    return $reservation;
}

/** Only the authenticated admin endpoint calls this enrichment function. */
function closed_admin_metadata(array $records): array {
    if(!$records)return $records;
    if(!closed_lists_ready()){
        foreach($records as &$r){
            $r['approval_status']='approved';
            $r['invitation_path']=null;
            $r['invitation_issue']='schema_missing';
            $r['registered_people']=0;
            $r['invite_registrations']=[];
        }
        unset($r);
        return $records;
    }
    $ids=array_column($records,'id');$marks=implode(',',array_fill(0,count($ids),'?'));
    $approvals=[];$participants=[];
    foreach(rows("SELECT reservation_id,approval_status,invitation_token,approval_reason,reviewed_at,request_kind FROM closed_list_approvals WHERE reservation_id IN ($marks)",$ids) as $a)$approvals[$a['reservation_id']]=$a;
    foreach(rows("SELECT id,reservation_id,name,whatsapp,created_at FROM closed_list_participants WHERE reservation_id IN ($marks) ORDER BY created_at,id",$ids) as $p){
        $rid=$p['reservation_id'];unset($p['reservation_id']);$participants[$rid][]=$p;
    }
    foreach($records as &$r){
        $a=$approvals[$r['id']]??null;
        $r['request_kind']=$a['request_kind']??'lista_fechada';
        $r['approval_status']=$a['approval_status']??'approved';
        $r['approval_reason']=$a['approval_reason']??'';
        $r['reviewed_at']=$a['reviewed_at']??null;
        $r['invite_registrations']=$participants[$r['id']]??[];
        $r['registered_people']=count($r['invite_registrations']);
        $r=closed_admin_roster_with_invite_names($r);
        $r['invitation_path']=null;
        $r['invitation_issue']='none';
        if($r['approval_status']==='pending' || $r['approval_status']==='rejected'){
            $r['invitation_issue']=$r['approval_status'];
        } elseif(!in_array($r['status'],active_statuses(),true)
            || !closed_registration_open(array_merge($r,['booking_date'=>$r['date']]))) {
            $r['invitation_issue']='closed';
        } elseif(!$a){
            $r['invitation_issue']=$r['status']==='pending' ? 'legacy_pending' : 'missing_approval';
        } elseif(empty($a['invitation_token'])){
            $r['invitation_issue']='missing_token';
        } else {
            $r['invitation_issue']='available';
            $r['invitation_path']='/convite.html#token='.$a['invitation_token'];
        }
    }
    unset($r);
    return $records;
}
