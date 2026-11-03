<?php
return [
    'host' => 'localhost',
    'port' => 3306,
    'database' => 'u664280783_campoferrariv2',
    'username' => 'u664280783_ferrari_v2',
    'password' => 'COLOQUE_AQUI_SUA_NOVA_SENHA',
    'setup_key' => 'COLOQUE_AQUI_UMA_NOVA_CHAVE_ALEATORIA_DE_32_CARACTERES_OU_MAIS',
    // Configure ambos os provedores no arquivo PRIVADO api/config.local.php.
    // Use um endereço remetente autorizado no servidor SMTP contratado.
    'notification_smtp' => [
        'host' => 'SEU_SERVIDOR_SMTP',
        'port' => 587,
        'encryption' => 'tls', // tls: STARTTLS 587; ssl: TLS direto 465
        'username' => 'notificacoes@seu-dominio.com.br',
        'password' => 'SENHA_DE_APLICATIVO_OU_CAIXA_EMAIL',
        'from_email' => 'notificacoes@seu-dominio.com.br',
    ],
    // WhatsApp Business Cloud API (Meta). Necessário template APROVADO.
    'notification_whatsapp_cloud' => [
        'phone_number_id' => 'SEU_PHONE_NUMBER_ID',
        'access_token' => 'TOKEN_PERMANENTE_DE_SISTEMA',
        'template_name' => 'nova_reserva_admin',
        'language_code' => 'pt_BR',
        'graph_version' => 'v23.0',
    ],
];