# 🎯 CAMPO FERRARI AIRSOFT

### Plataforma Web de Gerenciamento de Partidas, Reservas e Participantes

![Status](https://img.shields.io/badge/Status-Em%20desenvolvimento-orange)
![Versão](https://img.shields.io/badge/Vers%C3%A3o-9.0-blue)
![PHP](https://img.shields.io/badge/PHP-Backend-777BB4)
![MySQL](https://img.shields.io/badge/MySQL-Database-4479A1)
![JavaScript](https://img.shields.io/badge/JavaScript-Frontend-F7DF1E)
![HTML5](https://img.shields.io/badge/HTML5-Markup-E34F26)
![CSS3](https://img.shields.io/badge/CSS3-Style-1572B6)

---

## 📌 Sobre o Projeto

O **Campo Ferrari Airsoft** é uma plataforma web desenvolvida para oferecer uma experiência moderna, interativa e organizada aos jogadores e administradores do campo.

O projeto reúne informações sobre o estabelecimento, gerenciamento de partidas, controle de participantes, reservas e integração com ferramentas de comunicação.

📍 **Localização:** Videira – Santa Catarina – Brasil

🌐 **Site oficial:** https://campoferrari.com.br/

## 🚀 Funcionalidades

### 🌐 Interface Pública

- Layout moderno e responsivo para computadores, tablets e celulares.
- Apresentação institucional do Campo Ferrari Airsoft.
- Galeria de imagens e carrosséis interativos.
- Informações sobre equipamentos disponíveis para locação.
- Integração com WhatsApp.
- Integração com Instagram.
- Localização via Google Maps.
- Perguntas frequentes (FAQ).
- Informações sobre infraestrutura e serviços disponíveis.

### 🎯 Gerenciamento de Partidas

- Criação e organização de partidas.
- Listas abertas e fechadas de participantes.
- Cadastro de jogadores e acompanhantes.
- Controle da quantidade de participantes.
- Exibição dos nomes dos acompanhantes.
- Informações de data, horário e valores.
- Compartilhamento das listas pelo WhatsApp.
- Atualização das informações de participação.

### 🔐 Painel Administrativo

- Área administrativa para gerenciamento do sistema.
- Controle de partidas e listas.
- Administração dos participantes.
- Consulta e revisão de informações financeiras.
- Integração com banco de dados MySQL.
- Operações de gerenciamento pelo backend PHP.

## 🛠️ Tecnologias Utilizadas

| Tecnologia | Aplicação |
|---|---|
| HTML5 | Estrutura das páginas |
| CSS3 | Estilização, responsividade e animações |
| JavaScript | Interatividade e funcionalidades dinâmicas |
| PHP | Backend, APIs e regras de negócio |
| MySQL | Armazenamento de informações |
| Apache | Servidor web e regras `.htaccess` |
| Git | Controle de versões |
| GitHub | Hospedagem e gerenciamento do código |

## 📂 Estrutura do Projeto

Principais diretórios e arquivos:

- **admin/** — Painel administrativo.
- **api/** — Backend e comunicação com o banco de dados.
- **assets/** — Imagens, estilos e recursos visuais.
- **database/** — Recursos relacionados ao banco de dados.
- **maintenance/** — Arquivos de manutenção.
- **index.html** — Página principal do site.
- **404.html** — Página personalizada para erros 404.
- **.htaccess** — Configuração do servidor Apache.
- **robots.txt** — Orientações de rastreamento.
- **sitemap.xml** — Mapa de páginas para buscadores.
- **politica-de-privacidade.html** — Política de privacidade.

## ⚙️ Instalação Local

### Pré-requisitos

- PHP compatível com o projeto.
- MySQL.
- Apache.
- Laragon, XAMPP ou ambiente equivalente.
- Git.
- Visual Studio Code (recomendado).

### 1. Clonar o repositório

```bash
git clone https://github.com/WillianF3/Campo_Ferrari.git
```

### 2. Acessar o projeto

```bash
cd Campo_Ferrari
```

### 3. Configurar o ambiente

Copie o projeto para o diretório do servidor local, como `C:\laragon\www\Campo_Ferrari`.

Inicie os serviços Apache e MySQL.

### 4. Configurar o banco de dados

1. Acesse o gerenciador MySQL.
2. Crie um banco de dados para o projeto.
3. Importe o script SQL correspondente, quando disponível.
4. Configure a conexão com o banco no arquivo local de configuração utilizado pela API.
5. Confira as permissões de acesso.

**Nunca publique credenciais reais do banco de dados no GitHub.**

### 5. Executar o projeto

Com o Laragon configurado, acesse o endereço local correspondente ao projeto, como:

`http://localhost/Campo_Ferrari/`

O endereço poderá variar conforme a configuração do servidor.

## 🌐 Publicação na Hostinger

O projeto pode ser hospedado em um ambiente compatível com PHP e MySQL.

Etapas gerais:

1. Configurar a hospedagem e o domínio.
2. Criar o banco de dados MySQL.
3. Importar a estrutura SQL necessária.
4. Enviar os arquivos do site para `public_html`.
5. Configurar as credenciais do banco no servidor.
6. Verificar o funcionamento da API e do painel administrativo.
7. Habilitar HTTPS/SSL.
8. Testar páginas, links, formulários e funcionalidades.

## 🔒 Segurança

O projeto deve seguir boas práticas de segurança:

- Não versionar senhas e credenciais.
- Proteger configurações privadas.
- Validar informações recebidas do usuário.
- Utilizar consultas parametrizadas no banco de dados.
- Restringir o acesso às áreas administrativas.
- Manter backups seguros do banco de dados.
- Utilizar conexões HTTPS em produção.

## 🌿 Controle de Versões

| Branch | Finalidade |
|---|---|
| `main` | Versão principal e estável |
| `develop` | Desenvolvimento e testes |
| `versao-v9` | Evolução da versão 9 do projeto |

### Atualizações com Git

```bash
git add .
git commit -m "feat: atualiza funcionalidades do Campo Ferrari"
git push
```

Antes de executar os comandos, confira se a branch correta está selecionada e se não há arquivos privados incluídos.

## 🔮 Melhorias Futuras

Possíveis evoluções do projeto:

- Notificações automáticas de reservas.
- Melhorias na experiência mobile.
- Dashboard com estatísticas de partidas.
- Relatórios administrativos.
- Aprimoramentos de desempenho e acessibilidade.
- Novas animações e elementos interativos.
- Otimizações contínuas de SEO.

## 👨‍💻 Desenvolvedor

**Willian Ferreira Teixeira**

Estudante de Ciência da Computação e desenvolvedor web.

- GitHub: [@WillianF3](https://github.com/WillianF3)
- LinkedIn: [Willian Ferreira](https://www.linkedin.com/in/willian-ferreira-a09730219/)
- Portfólio: https://devwillian.com/

## 📍 Campo Ferrari Airsoft

**Videira – Santa Catarina – Brasil**

🌐 https://campoferrari.com.br/

---

**Campo Ferrari Airsoft — La Tradizione Continua 🇮🇹**

*Desenvolvimento e evolução contínua da plataforma.*

© 2026 Campo Ferrari Airsoft. Todos os direitos reservados.
