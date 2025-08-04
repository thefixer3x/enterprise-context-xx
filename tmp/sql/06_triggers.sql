-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS memory_version_trigger ON memory_entries;
DROP TRIGGER IF EXISTS update_organizations_updated_at ON organizations;
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
DROP TRIGGER IF EXISTS update_topics_updated_at ON topics;
DROP TRIGGER IF EXISTS update_memory_entries_updated_at ON memory_entries;

-- Create triggers
CREATE TRIGGER memory_version_trigger
  AFTER UPDATE ON memory_entries
  FOR EACH ROW
  EXECUTE FUNCTION create_memory_version();

CREATE TRIGGER update_organizations_updated_at 
  BEFORE UPDATE ON organizations 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at 
  BEFORE UPDATE ON users 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_topics_updated_at 
  BEFORE UPDATE ON topics 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_memory_entries_updated_at 
  BEFORE UPDATE ON memory_entries 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
