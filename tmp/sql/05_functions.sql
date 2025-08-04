-- Vector search function
CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 20,
  organization_id_param uuid DEFAULT NULL,
  memory_types_param memory_type[] DEFAULT NULL,
  tags_param text[] DEFAULT NULL,
  topic_id_param uuid DEFAULT NULL,
  user_id_param uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  title varchar(200),
  content text,
  memory_type memory_type,
  tags text[],
  topic_id uuid,
  user_id uuid,
  organization_id uuid,
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  last_accessed timestamptz,
  access_count integer,
  relevance_score float
) LANGUAGE sql STABLE AS $$
  SELECT
    me.id,
    me.title,
    me.content,
    me.memory_type,
    me.tags,
    me.topic_id,
    me.user_id,
    me.organization_id,
    me.metadata,
    me.created_at,
    me.updated_at,
    me.last_accessed,
    me.access_count,
    1 - (me.embedding <=> query_embedding) AS relevance_score
  FROM memory_entries me
  WHERE
    (organization_id_param IS NULL OR me.organization_id = organization_id_param)
    AND (memory_types_param IS NULL OR me.memory_type = ANY(memory_types_param))
    AND (tags_param IS NULL OR me.tags && tags_param)
    AND (topic_id_param IS NULL OR me.topic_id = topic_id_param)
    AND (user_id_param IS NULL OR me.user_id = user_id_param)
    AND (me.embedding <=> query_embedding) < (1 - match_threshold)
    AND me.embedding IS NOT NULL
  ORDER BY me.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Access tracking function
CREATE OR REPLACE FUNCTION update_memory_access(memory_id_param uuid)
RETURNS void LANGUAGE sql AS $$
  UPDATE memory_entries 
  SET 
    last_accessed = NOW(),
    access_count = access_count + 1
  WHERE id = memory_id_param;
$$;

-- Updated timestamp function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Memory versioning function
CREATE OR REPLACE FUNCTION create_memory_version()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  next_version INTEGER;
BEGIN
  SELECT COALESCE(MAX(version_number), 0) + 1
  INTO next_version
  FROM memory_versions
  WHERE memory_id = NEW.id;
  
  INSERT INTO memory_versions (
    memory_id, title, content, memory_type, tags, topic_id, 
    metadata, created_by, version_number
  ) VALUES (
    NEW.id, NEW.title, NEW.content, NEW.memory_type, NEW.tags, 
    NEW.topic_id, NEW.metadata, NEW.user_id, next_version
  );
  
  RETURN NEW;
END;
$$;
