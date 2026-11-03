<?php
/** Galeria pública de prévias / gerenciamento privado no painel.
 * Não armazena os originais: apenas imagens WebP reduzidas e com marca-d'água.
 * Sem dependência de migração do banco. Requer PHP-GD e diretórios graváveis para upload.
 */
declare(strict_types=1);

function photo_directory(): string { return dirname(__DIR__).'/assets/images/fotos'; }
function photo_private_directory(): string { return __DIR__.'/private-gallery'; }
function gallery_logo_path(): string { return dirname(__DIR__).'/assets/images/logo.webp'; }

/** Memoriza exclusões: um ZIP antigo reenviado não pode republicar fotos excluídas. */
function gallery_deleted_codes(): array {
    $file=photo_private_directory().'/deleted.txt';
    if(!is_file($file))return [];
    $lines=@file($file,FILE_IGNORE_NEW_LINES|FILE_SKIP_EMPTY_LINES)?:[];
    return array_fill_keys(array_filter(array_map('trim',$lines),static fn($code)=>preg_match('/^CF-[0-9]{3,6}$/D',$code)),true);
}

function gallery_list(): array {
    $items=[];
    $directory=photo_directory();
    if(!is_dir($directory))return [];
    $deleted=gallery_deleted_codes();
    foreach(new DirectoryIterator($directory) as $item){
        if(!$item->isFile() || $item->isLink())continue;
        $name=$item->getFilename();
        if(!preg_match('/^(CF-([0-9]{3,6}))\.webp$/D',$name,$matches))continue;
        if(isset($deleted[$matches[1]]))continue;
        $items[]=['code'=>$matches[1],'url'=>'assets/images/fotos/'.$name,'number'=>(int)$matches[2]];
    }
    usort($items,static fn($a,$b)=>$a['number']<=>$b['number']);
    return array_map(static fn($item)=>['code'=>$item['code'],'url'=>$item['url']],$items);
}

/** Reserva códigos sem reutilizar um código de foto já excluída. */
function gallery_next_code(): string {
    $private=photo_private_directory();
    if(!is_dir($private) && !@mkdir($private,0750,true) && !is_dir($private))fail(503,'Pasta privada da galeria sem permissão de escrita.');
    $state=$private.'/sequence.txt';
    $handle=@fopen($state,'c+');
    if(!$handle)fail(503,'Não foi possível gravar a numeração das fotos.');
    if(!flock($handle,LOCK_EX)){fclose($handle);fail(503,'Não foi possível reservar o código da foto.');}
    rewind($handle);
    $saved=(int)trim(stream_get_contents($handle));
    $numbers=array_map(static fn($item)=>(int)substr($item['code'],3),gallery_list());
    foreach(array_keys(gallery_deleted_codes()) as $deletedCode)$numbers[]=(int)substr($deletedCode,3);
    $next=max($saved, $numbers?max($numbers):0)+1;
    if($next>999999){flock($handle,LOCK_UN);fclose($handle);fail(507,'Limite de códigos da galeria atingido.');}
    rewind($handle);ftruncate($handle,0);fwrite($handle,(string)$next);fflush($handle);
    flock($handle,LOCK_UN);fclose($handle);
    return 'CF-'.str_pad((string)$next,3,'0',STR_PAD_LEFT);
}

/** Aplica uma marca-d'água permanente com a logo do Campo Ferrari e o aviso de prévia. */
function gallery_apply_watermark(GdImage $canvas, string $code): void {
    $outW=imagesx($canvas);
    $outH=imagesy($canvas);
    imagealphablending($canvas,true);
    imagesavealpha($canvas,true);

    $tileW=(int)max(220,min(420,round($outW*0.34)));
    $tileH=(int)round($tileW*0.22);
    $tile=imagecreatetruecolor($tileW,$tileH);
    imagealphablending($tile,false);
    imagesavealpha($tile,true);
    imagefilledrectangle($tile,0,0,$tileW,$tileH,imagecolorallocatealpha($tile,0,0,0,127));
    imagealphablending($tile,true);

    $logo=@imagecreatefromwebp(gallery_logo_path());
    if($logo){
        $logoSize=(int)max(34,min(58,round($tileH*0.72)));
        $logoY=(int)max(0,round(($tileH-$logoSize)/2));
        imagecopyresampled($tile,$logo,6,$logoY,0,0,$logoSize,$logoSize,imagesx($logo),imagesy($logo));
        imagedestroy($logo);
    }

    $textColor=imagecolorallocatealpha($tile,255,255,255,50);
    $textShadow=imagecolorallocatealpha($tile,0,0,0,86);
    $label='CAMPO FERRARI • PRÉVIA';
    $textX=(int)max(48,min($tileW-150,round($tileW*0.19)));
    $textY=(int)max(4,round(($tileH-15)/2));
    imagestring($tile,5,$textX+1,$textY+1,$label,$textShadow);
    imagestring($tile,5,$textX,$textY,$label,$textColor);

    $shade=imagecolorallocatealpha($canvas,0,0,0,108);
    $stepY=max((int)round($tileH*2.6),96);
    $stepX=max((int)round($tileW*1.1),220);
    for($y=(int)round($stepY*0.55);$y<$outH;$y+=$stepY){
        imagefilledrectangle($canvas,0,max(0,$y-16),$outW,min($outH-1,$y+$tileH+16),$shade);
        for($x=-(int)round($tileW*0.28);$x<$outW;$x+=$stepX){
            imagecopy($canvas,$tile,$x,$y,0,0,$tileW,$tileH);
        }
    }
    imagedestroy($tile);

    $badgeW=(int)max(160,min(250,round($outW*0.28)));
    $badgeH=(int)max(44,min(70,round($badgeW*0.28)));
    $badgeX=max(12,$outW-$badgeW-18);
    $badgeY=max(12,$outH-$badgeH-18);
    $badge=imagecreatetruecolor($badgeW,$badgeH);
    imagealphablending($badge,false);
    imagesavealpha($badge,true);
    imagefilledrectangle($badge,0,0,$badgeW,$badgeH,imagecolorallocatealpha($badge,10,10,10,42));
    imagealphablending($badge,true);
    imagerectangle($badge,0,0,$badgeW-1,$badgeH-1,imagecolorallocatealpha($badge,255,176,46,40));

    $badgeLogo=@imagecreatefromwebp(gallery_logo_path());
    if($badgeLogo){
        $badgeLogoSize=(int)round($badgeH*0.72);
        $badgeLogoY=(int)round(($badgeH-$badgeLogoSize)/2);
        imagecopyresampled($badge,$badgeLogo,8,$badgeLogoY,0,0,$badgeLogoSize,$badgeLogoSize,imagesx($badgeLogo),imagesy($badgeLogo));
        imagedestroy($badgeLogo);
    }
    $badgeText=imagecolorallocatealpha($badge,255,255,255,24);
    $badgeAccent=imagecolorallocatealpha($badge,255,176,46,8);
    $tx=(int)min($badgeW-120,round($badgeH*0.86));
    imagestring($badge,4,$tx,10,'CAMPO FERRARI',$badgeText);
    imagestring($badge,3,$tx,28,$code.' • PRÉVIA',$badgeAccent);
    imagecopy($canvas,$badge,$badgeX,$badgeY,0,0,$badgeW,$badgeH);
    imagedestroy($badge);
}

function gallery_add(): never {
    if(!extension_loaded('gd') || !function_exists('imagewebp'))fail(503,'Ative a extensão PHP GD com suporte a WebP na hospedagem.');
    if(!isset($_FILES['image']) || !is_array($_FILES['image']))fail(422,'Selecione uma foto JPG, PNG ou WebP.');
    $upload=$_FILES['image'];
    $error=(int)($upload['error']??UPLOAD_ERR_NO_FILE);
    if($error!==UPLOAD_ERR_OK){
        if(in_array($error,[UPLOAD_ERR_INI_SIZE,UPLOAD_ERR_FORM_SIZE],true))fail(413,'A imagem excede o limite de upload configurado no PHP.');
        fail(422,'Não foi possível receber a imagem. Verifique o arquivo e as permissões da hospedagem.');
    }
    $size=(int)($upload['size']??0);$tmp=$upload['tmp_name']??'';
    if($size<100 || $size>8*1024*1024 || !is_string($tmp) || !is_uploaded_file($tmp))fail(422,'Envie um arquivo de imagem de até 8 MB.');
    $info=@getimagesize($tmp);
    if(!$info || !isset($info[0],$info[1],$info[2]))fail(422,'Arquivo de imagem inválido.');
    [$width,$height,$kind]=$info;
    if($width<120 || $height<120 || ($width*$height)>24000000)fail(422,'A imagem deve ter pelo menos 120 px e no máximo 24 megapixels.');
    $mime=(new finfo(FILEINFO_MIME_TYPE))->file($tmp);
    $types=[IMAGETYPE_JPEG=>'image/jpeg',IMAGETYPE_PNG=>'image/png',IMAGETYPE_WEBP=>'image/webp'];
    if(!isset($types[$kind]) || $mime!==$types[$kind])fail(422,'Formato inválido. Use JPG, PNG ou WebP.');
    $input=match($kind){
        IMAGETYPE_JPEG=>@imagecreatefromjpeg($tmp),
        IMAGETYPE_PNG=>@imagecreatefrompng($tmp),
        IMAGETYPE_WEBP=>@imagecreatefromwebp($tmp),
    };
    if(!$input)fail(422,'Não foi possível processar esta foto.');
    // Imagens com orientação EXIF de câmeras / celulares.
    if($kind===IMAGETYPE_JPEG && function_exists('exif_read_data')){
        $exif=@exif_read_data($tmp);
        $orientation=(int)($exif['Orientation']??1);
        if($orientation===3)$input=imagerotate($input,180,0);
        if($orientation===6)$input=imagerotate($input,-90,0);
        if($orientation===8)$input=imagerotate($input,90,0);
        $width=imagesx($input);$height=imagesy($input);
    }
    $ratio=min(1.0,960/max($width,$height));
    $outW=max(1,(int)round($width*$ratio));$outH=max(1,(int)round($height*$ratio));
    $canvas=imagecreatetruecolor($outW,$outH);
    imagefilledrectangle($canvas,0,0,$outW,$outH,imagecolorallocate($canvas,18,18,18));
    imagecopyresampled($canvas,$input,0,0,0,0,$outW,$outH,$width,$height);
    imagedestroy($input);

    $directory=photo_directory();
    if(!is_dir($directory) && !@mkdir($directory,0755,true) && !is_dir($directory)){
        imagedestroy($canvas);fail(503,'A pasta de fotos não possui permissão de escrita.');
    }
    $code=gallery_next_code();
    gallery_apply_watermark($canvas,$code);
    $destination=$directory.'/'.$code.'.webp';
    // Apenas a prévia marcada é colocada na pasta pública, nunca o upload original.
    if(file_exists($destination) || !@imagewebp($canvas,$destination,78)){
        imagedestroy($canvas);fail(503,'Não foi possível salvar a prévia. Confira as permissões de assets/images/fotos.');
    }
    imagedestroy($canvas);
    @chmod($destination,0644);
    result(['ok'=>true,'photo'=>['code'=>$code,'url'=>'assets/images/fotos/'.$code.'.webp']],201);
}

function gallery_delete(string $code): never {
    if(!preg_match('/^CF-[0-9]{3,6}$/D',$code))fail(422,'Código da foto inválido.');
    $file=photo_directory().'/'.$code.'.webp';
    if(!is_file($file) || is_link($file))fail(404,'Esta foto não existe mais.');
    $private=photo_private_directory();
    if(!is_dir($private) && !@mkdir($private,0750,true) && !is_dir($private))fail(503,'Pasta privada da galeria sem permissão de escrita.');
    $handle=@fopen($private.'/deleted.txt','a+');
    if(!$handle)fail(503,'Não foi possível registrar a exclusão.');
    if(!flock($handle,LOCK_EX)){fclose($handle);fail(503,'Não foi possível bloquear o registro de exclusões.');}
    if(!@unlink($file)){
        flock($handle,LOCK_UN);fclose($handle);
        fail(503,'Não foi possível excluir a foto. Verifique as permissões da pasta.');
    }
    fwrite($handle,$code."\n");fflush($handle);
    flock($handle,LOCK_UN);fclose($handle);
    result(['ok'=>true,'deleted'=>$code]);
}
