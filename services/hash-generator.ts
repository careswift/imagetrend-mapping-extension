/**
 * Form Hash Generator
 * Generates SHA-256 hash from form data for verification
 */

export class FormHashGenerator {
  /**
   * Generate SHA-256 hash from form data
   * Simplified to only hash fields and resource groups for stability
   */
  async generateHash(formData: any): Promise<string> {
    try {
      // Create simplified structure with only what matters for form structure
      const structureHash = {
        fields: (formData.fields || [])
          .map((f: any) => ({
            id: String(f.id || ''),
            bindingPath: f.bindingPath || null
          }))
          .sort((a: any, b: any) => a.id.localeCompare(b.id)),
        resourceGroups: (formData.resourceGroups || [])
          .map((g: any) => ({
            id: String(g.id || ''),
            count: g.elements?.length || 0
          }))
          .sort((a: any, b: any) => a.id.localeCompare(b.id))
      };
      
      // Debug: Log what we're hashing
      console.log('[FormHashGenerator] Simplified structure:', {
        fieldCount: structureHash.fields.length,
        resourceGroupCount: structureHash.resourceGroups.length,
        firstField: structureHash.fields[0],
        firstResourceGroup: structureHash.resourceGroups[0],
        sampleFields: structureHash.fields.slice(0, 3),
        sampleResourceGroups: structureHash.resourceGroups.slice(0, 3)
      });
      
      // Convert to JSON string - this simplified structure should be deterministic
      const jsonString = JSON.stringify(structureHash);
      
      // Generate SHA-256 hash using Web Crypto API
      const encoder = new TextEncoder();
      const data = encoder.encode(jsonString);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      
      // Convert to hex string (matching Go's hex.EncodeToString)
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      
      console.log('[FormHashGenerator] Generated hash:', {
        dataLength: jsonString.length,
        hash: hashHex,
        firstChars: jsonString.substring(0, 200),
        lastChars: jsonString.substring(jsonString.length - 200)
      });
      
      // Debug: Log the actual structure being hashed
      console.log('[FormHashGenerator] Form data structure:', {
        hasDebug: !!formData.debug,
        debugKeys: formData.debug ? Object.keys(formData.debug) : [],
        hasFields: !!formData.fields,
        fieldCount: formData.fields?.length,
        hasResourceGroups: !!formData.resourceGroups,
        resourceGroupCount: formData.resourceGroups?.length,
        hasFormActions: !!formData.formActions,
        formActionKeys: formData.formActions ? Object.keys(formData.formActions) : [],
        hasStats: !!formData.stats,
        statsKeys: formData.stats ? Object.keys(formData.stats) : [],
        topLevelKeys: Object.keys(formData).sort()
      });
      
      return hashHex;
      
    } catch (error) {
      console.error('[FormHashGenerator] Hash generation failed:', error);
      throw new Error('Failed to generate form hash');
    }
  }
  
  /**
   * Generate a quick hash for comparison (less strict normalization)
   * This is useful for debugging when hashes don't match
   */
  async generateQuickHash(formData: any): Promise<string> {
    try {
      // Use only the most essential fields for a quick hash
      const quickData = {
        formId: formData.formHierarchyCollectionId,
        fieldCount: formData.fields?.length || 0,
        fieldIds: formData.fields?.map((f: any) => f.id).sort() || [],
        resourceGroupIds: formData.resourceGroups?.map((g: any) => g.id).sort() || []
      };
      
      const jsonString = JSON.stringify(quickData);
      const encoder = new TextEncoder();
      const data = encoder.encode(jsonString);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      
    } catch (error) {
      console.error('[FormHashGenerator] Quick hash generation failed:', error);
      return '';
    }
  }
}

export const formHashGenerator = new FormHashGenerator();