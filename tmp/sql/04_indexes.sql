-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_organizations_plan ON organizations(plan);
CREATE INDEX IF NOT EXISTS idx_users_organization_id ON users(organization_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_organization_role ON users(organization_id, role);

CREATE INDEX IF NOT EXISTS idx_topics_organization_id ON topics(organization_id);
CREATE INDEX IF NOT EXISTS idx_topics_user_id ON topics(user_id);

CREATE INDEX IF NOT EXISTS idx_memory_entries_organization_id ON memory_entries(organization_id);
CREATE INDEX IF NOT EXISTS idx_memory_entries_user_id ON memory_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_memory_entries_memory_type ON memory_entries(memory_type);
CREATE INDEX IF NOT EXISTS idx_memory_entries_topic_id ON memory_entries(topic_id);
CREATE INDEX IF NOT EXISTS idx_memory_entries_created_at ON memory_entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_entries_updated_at ON memory_entries(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_entries_last_accessed ON memory_entries(last_accessed DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_memory_entries_access_count ON memory_entries(access_count DESC);
CREATE INDEX IF NOT EXISTS idx_memory_entries_tags ON memory_entries USING GIN(tags);

-- Vector similarity index
DO $$ BEGIN
    CREATE INDEX idx_memory_entries_embedding ON memory_entries USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
EXCEPTION
    WHEN duplicate_table THEN null;
END $$;

CREATE INDEX IF NOT EXISTS idx_memory_versions_memory_id ON memory_versions(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_versions_created_at ON memory_versions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_keys_organization_id ON api_keys(organization_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active);

CREATE INDEX IF NOT EXISTS idx_usage_analytics_organization_id ON usage_analytics(organization_id);
CREATE INDEX IF NOT EXISTS idx_usage_analytics_user_id ON usage_analytics(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_analytics_action ON usage_analytics(action);
CREATE INDEX IF NOT EXISTS idx_usage_analytics_timestamp ON usage_analytics(timestamp DESC);
