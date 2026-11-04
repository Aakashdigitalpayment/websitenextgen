-- Settings used by notifications, AI chat and web push (per tenant). Safe to re-run.
INSERT INTO site_settings (setting_key, setting_value, setting_type, setting_label, setting_group) VALUES
  ('notify_email_enabled', '0', 'text', 'Email notifications on (1/0)', 'notify'),
  ('notify_admin_emails', '', 'text', 'Admin emails for new applications (comma separated)', 'notify'),
  ('smtp_host', '', 'text', 'SMTP host', 'notify'),
  ('smtp_port', '587', 'number', 'SMTP port', 'notify'),
  ('smtp_encryption', 'tls', 'text', 'SMTP encryption (tls / ssl / none)', 'notify'),
  ('smtp_user', '', 'text', 'SMTP username', 'notify'),
  ('smtp_password', '', 'text', 'SMTP password', 'notify'),
  ('smtp_from_email', '', 'text', 'From email', 'notify'),
  ('smtp_from_name', '', 'text', 'From name', 'notify'),
  ('notify_sms_enabled', '0', 'text', 'SMS notifications on (1/0)', 'notify'),
  ('notify_sms_gateway', 'sparrow', 'text', 'SMS gateway (sparrow / aakash / webhook)', 'notify'),
  ('notify_sms_token', '', 'text', 'SMS API token', 'notify'),
  ('notify_sms_sender_id', '', 'text', 'SMS sender id', 'notify'),
  ('notify_sms_api_url', '', 'url', 'SMS API URL (aakash / webhook)', 'notify'),
  ('notify_member_sms', '1', 'text', 'SMS applicants on status change (1/0)', 'notify'),
  ('notify_member_email', '1', 'text', 'Email applicants on status change (1/0)', 'notify'),
  ('ai_enabled', '0', 'text', 'AI chat on (1/0)', 'ai'),
  ('ai_provider', 'gemini', 'text', 'AI provider (gemini / openai / deepseek)', 'ai'),
  ('ai_api_key', '', 'text', 'AI API key', 'ai'),
  ('ai_model', '', 'text', 'AI model (blank = provider default)', 'ai'),
  ('ai_welcome', 'नमस्ते! म तपाईंलाई कसरी सहयोग गर्न सक्छु?', 'text', 'Chat welcome message', 'ai'),
  ('ai_extra_context', '', 'textarea', 'Extra facts for the assistant', 'ai')
ON CONFLICT (setting_key) DO UPDATE SET setting_group = EXCLUDED.setting_group;

-- default notification templates ({{name}}, {{tracking_id}}, {{module}}, {{status}}, {{remarks}}, {{site}})
INSERT INTO notification_templates (event_type, audience, channel, enabled, subject, body, variables)
SELECT * FROM (VALUES
  ('submitted', 'member', 'sms', 1, '', '{{site}}: तपाईंको {{module}} प्राप्त भयो। ट्र्याकिङ नं {{tracking_id}}', 'name,tracking_id,module,site'),
  ('submitted', 'member', 'email', 1, '{{module}} प्राप्त भयो — {{tracking_id}}', 'नमस्ते {{name}},\n\nतपाईंको {{module}} प्राप्त भयो। ट्र्याकिङ नम्बर: {{tracking_id}}\n\n{{site}}', 'name,tracking_id,module,site'),
  ('submitted', 'admin', 'email', 1, 'नयाँ {{module}}: {{name}}', 'नयाँ {{module}} आएको छ।\nनाम: {{name}}\nट्र्याकिङ: {{tracking_id}}\n\nAdmin panel मा हेर्नुहोस्।', 'name,tracking_id,module,site'),
  ('status_changed', 'member', 'sms', 1, '', '{{site}}: {{module}} ({{tracking_id}}) को स्थिति: {{status}}। {{remarks}}', 'name,tracking_id,module,status,remarks,site'),
  ('status_changed', 'member', 'email', 1, '{{module}} — {{status}}', 'नमस्ते {{name}},\n\nतपाईंको {{module}} ({{tracking_id}}) को स्थिति अब: {{status}}\n{{remarks}}\n\n{{site}}', 'name,tracking_id,module,status,remarks,site')
) AS v(event_type, audience, channel, enabled, subject, body, variables)
WHERE NOT EXISTS (SELECT 1 FROM notification_templates t WHERE t.event_type = v.event_type AND t.audience = v.audience AND t.channel = v.channel);

CREATE UNIQUE INDEX IF NOT EXISTS member_push_subscriptions_endpoint_uq ON member_push_subscriptions (md5(endpoint));
