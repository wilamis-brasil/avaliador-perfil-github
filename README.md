# Avaliador de Perfil Profissional do Github 🚀

![Version](https://img.shields.io/badge/version-4.3-blue) ![License](https://img.shields.io/badge/license-MIT-green) ![Status](https://img.shields.io/badge/status-active-success)

**GithubAuditor Premium**

> **Acesse online:** [wilamis-brasil.github.io/avaliador-perfil-github](https://wilamis-brasil.github.io/avaliador-perfil-github)

O **GitAuditor Premium** é uma ferramenta avançada de análise estática e comportamental para perfis do GitHub. Ele audita sua conta baseando-se nas melhores práticas da indústria, guias oficiais do GitHub e OpenSource.guide, fornecendo um feedback acionável para melhorar sua presença profissional como desenvolvedor.

---

## 🎯 Objetivo

Ajudar desenvolvedores a transformar seus perfis do GitHub em portfólios de alta conversão para recrutadores e colaboradores open source. A ferramenta atua como um "Consultor Sênior", analisando não apenas o código, mas a "saúde" da comunidade, segurança, governança e apresentação pessoal.

## ✨ Funcionalidades Principais

*   **📊 Score Profissional:** Algoritmo de pontuação (0-100) calibrado com métricas de mercado (Engenharia, Comunidade, Segurança, Perfil).
*   **🔍 Auditoria Profunda (Deep Scan):** Analisa repositórios em busca de arquivos críticos (`README`, `LICENSE`, `CONTRIBUTING`, `SECURITY.md`), presença de CI/CD (Actions) e Testes Automatizados.
*   **🏆 Badges de Autoridade:** Identifica níveis de senioridade (de *Novato* a *Veterano*) e influência na comunidade (*Rising Star* a *Famous*).
*   **🤖 Feedback de Recrutador (Simulado):** Gera uma opinião qualitativa simulando a visão de um Tech Recruiter ao visitar seu perfil.
*   **📋 Plano de Ação Prioritário:** Lista inteligente de tarefas ordenada por impacto (Alto/Médio/Baixo) para corrigir falhas rapidamente.
*   **📈 Análise de Consistência:** Verifica a frequência de commits e diversidade de projetos (não apenas o "green wall").

## 🛠️ Tecnologias Utilizadas

*   **Frontend:** HTML5 Semântico, CSS3 Moderno (CSS Variables, Grid/Flexbox), JavaScript (ES6+ Vanilla).
*   **API:** Integração direta com **GitHub REST API v3**.
*   **Design:** Interface inspirada no **GitHub Primer Design System** (Light Theme), focada em tipografia (`Inter` & `JetBrains Mono`) e usabilidade.
*   **Extras:** Oneko.js (Mascote interativo).

## 🚀 Como Usar

1.  Acesse a versão online ou rode localmente.
2.  Insira seu **GitHub Username**.
3.  **(Recomendado)** Insira um **Token Pessoal (Classic)** para aumentar o limite de requisições da API (de 60/h para 5000/h) e permitir análise de repositórios privados.
    *   *Nota: O token não é salvo em nenhum servidor, apenas na memória do seu navegador durante a sessão.*
4.  Clique em **"Iniciar Análise Profissional"**.
5.  Receba o relatório completo com notas, badges e dicas de melhoria.

## 📦 Instalação Local

Para rodar o projeto na sua máquina:

```bash
# 1. Clone este repositório
git clone https://github.com/wilamis-brasil/git-auditor.git

# 2. Entre na pasta do projeto
cd git-auditor

# 3. Abra o arquivo index.html no seu navegador
# OU, para uma melhor experiência (evitar bloqueios de CORS), use um servidor local:

# Com Python 3
python -m http.server

# Com Node.js (npx)
npx serve .
```

Acesse `http://localhost:8000` (ou a porta indicada).

## 🤝 Como Contribuir

Contribuições são super bem-vindas! Se você tem ideias para novos critérios de avaliação ou melhorias na interface:

1.  Faça um **Fork** do projeto.
2.  Crie uma **Branch** para sua feature (`git checkout -b feature/NovaAnalise`).
3.  Faça o **Commit** das suas mudanças (`git commit -m 'Add: Verificação de Sponsors'`).
4.  Faça o **Push** para a Branch (`git push origin feature/NovaAnalise`).
5.  Abra um **Pull Request**.

## 📝 Licença

Este projeto está sob a licença MIT. Sinta-se livre para usar, estudar e modificar.

---

<div align="center">
  <h3>Desenvolvido com 💜 por <a href="https://github.com/wilamis-brasil">Wilamis Brasil</a></h3>
  <p>Gostou da ferramenta? Considere apoiar o desenvolvimento!</p>
  
  <a href="https://github.com/sponsors/wilamis-brasil">
    <img src="https://img.shields.io/badge/Sponsor-Apoiar%20Projeto-bf3989?style=for-the-badge&logo=github-sponsors&logoColor=white" alt="Sponsor Button">
  </a>
</div>
