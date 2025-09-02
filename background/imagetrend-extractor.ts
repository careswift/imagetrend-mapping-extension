export default function imagetrendExtractor() {
  interface ImageTrendWindow extends Window {
    ko: any
    imagetrend: {
      formComposer: {
        agencyLayouts: any
        formFieldDictionary: any
        agencyResources: any
        formHierarchyCollectionId?: any
        reportingStandardId?: any
      }
      logicEngine: {
        indexedValidationActions: any
        indexedVisibilityActions: any
      }
    }
  }

  const win = window as ImageTrendWindow

  // Check for ImageTrend presence
  const checkForImageTrend = () => {
    const checkCount = { current: 0, max: 5 }
    
    const checkInterval = setInterval(() => {
      checkCount.current++
      
      // Check if ImageTrend objects exist
      if (win.imagetrend?.formComposer && win.ko) {
        clearInterval(checkInterval)
        console.log('[CareSwift MAIN] ImageTrend detected!', {
          formComposer: !!win.imagetrend.formComposer,
          ko: !!win.ko,
          url: window.location.href
        })
        window.postMessage({ type: 'IMAGETREND_DETECTED' }, '*')
        setupExtractionListener()
      } else if (checkCount.current >= checkCount.max) {
        clearInterval(checkInterval)
        // Don't spam console on non-ImageTrend sites
        if (window.location.hostname.includes('imagetrend')) {
          console.log('[CareSwift MAIN] ImageTrend not found after checking')
        }
        window.postMessage({ type: 'IMAGETREND_NOT_FOUND' }, '*')
      }
    }, 1000)
  }

  // Listen for extraction requests
  const setupExtractionListener = () => {
    window.addEventListener('message', (event) => {
      if (event.source !== window) return
      if (event.data.type === 'EXTRACT_MAPPING') {
        console.log('[CareSwift MAIN] Extraction requested')
        extractFormMapping()
      }
    })
  }

  // Deep extraction with debugging info
  const extractFormMapping = () => {
    try {
      console.group('[CareSwift MAIN] Starting extraction...')
      
      // Access through Knockout context to get vmObservable
      const context = win.ko?.contextFor(document.body)
      const rootVM = context?.$root
      const composer = rootVM?.composer?.()
      const vmObservable = composer?.vmObservable?.()
      
      // Fallback to direct access if needed
      const formComposer = win.imagetrend?.formComposer || composer
      const logicEngine = win.imagetrend?.logicEngine
      
      // Log what we have access to
      console.log('FormComposer keys:', Object.keys(formComposer || {}))
      console.log('LogicEngine keys:', Object.keys(logicEngine || {}))
      console.log('vmObservable keys:', Object.keys(vmObservable || {}))
      
      // Extract ALL data for debugging
      const formData = {
        timestamp: new Date().toISOString(),
        url: window.location.href,
        hostname: window.location.hostname,
        
        // Core IDs
        formHierarchyCollectionId: win.ko?.unwrap(formComposer.formHierarchyCollectionId),
        reportingStandardId: win.ko?.unwrap(formComposer.reportingStandardId),
        
        // Debug: Raw objects (be careful with size)
        debug: {
          formComposerKeys: Object.keys(formComposer || {}),
          logicEngineKeys: Object.keys(logicEngine || {}),
          hasKnockout: !!win.ko,
          sampleLayout: formComposer.agencyLayouts?.[0] ? 
            JSON.stringify(formComposer.agencyLayouts[0]).substring(0, 500) : null
        },
        
        // Extract fields with full details (pass resources for enum mapping)
        fields: extractFields(formComposer?.agencyLayouts, formComposer?.formFieldDictionary, vmObservable?.Resources || formComposer?.agencyResources),
        
        // Extract resource groups (enums)
        resourceGroups: extractResourceGroups(vmObservable?.Resources || formComposer?.agencyResources),
        
        // Extract FormActions (complete validation rules)
        formActions: extractFormActions(vmObservable?.FormActions),
        
        // Extract operator analysis
        operators: analyzeOperators(vmObservable?.FormActions),
        
        // Legacy rules extraction (if available)
        rules: extractRules(logicEngine?.indexedValidationActions, logicEngine?.indexedVisibilityActions),
        
        // Extract repeater metadata
        repeaters: extractRepeaters(formComposer?.agencyLayouts),
        
        // Include update functions for the backend - keeping empty to match regular extension for hash consistency
        updateFunctions: {},
        
        // Statistics
        stats: {
          fieldCount: 0,
          resourceGroupCount: 0,
          ruleCount: 0,
          repeaterCount: 0,
          fieldsWithBindingPath: 0,
          formActionCount: 0,
          validationRuleCount: 0,
          uniqueOperators: 0
        }
      }
      
      // Update stats
      formData.stats.fieldCount = formData.fields?.length || 0
      formData.stats.resourceGroupCount = formData.resourceGroups?.length || 0
      formData.stats.ruleCount = formData.rules?.length || 0
      formData.stats.repeaterCount = formData.repeaters?.length || 0
      formData.stats.fieldsWithBindingPath = formData.fields?.filter((f: any) => f.bindingPath).length || 0
      formData.stats.formActionCount = formData.formActions ? Object.values(formData.formActions).flat().length : 0
      formData.stats.validationRuleCount = formData.formActions ? 
        Object.values(formData.formActions).flat().filter((a: any) => a.ActionType === 'Validation').length : 0
      formData.stats.uniqueOperators = formData.operators?.expression?.length || 0
      
      console.log('Extraction stats:', formData.stats)
      console.groupEnd()
      
      // Send to content script
      window.postMessage({
        type: 'IMAGETREND_DATA',
        payload: formData
      }, '*')
      
    } catch (error: any) {
      console.error('[CareSwift MAIN] Extraction error:', error)
      window.postMessage({
        type: 'IMAGETREND_ERROR',
        payload: { 
          error: error.message,
          stack: error.stack
        }
      }, '*')
    }
  }

  // Extract fields from layouts with deep inspection
  const extractFields = (layouts: any, dictionary: any, resources?: any): any[] => {
    const fieldMap: { [key: string]: any } = {}
    
    // First, extract from formFieldDictionary for base field info
    if (dictionary && Array.isArray(dictionary)) {
      console.log(`[CareSwift] Processing formFieldDictionary with ${dictionary.length} entries`)
      
      dictionary.forEach((field: any) => {
        const fieldId = field.bpID || field.bindingPathEntryId
        fieldMap[fieldId] = {
          id: fieldId,
          key: field.key,
          label: field.key, // This is actually the label
          type: field.type || field.controlType,
          formId: field.formID,
          panelId: field.panelID,
          sectionId: field.sectionID,
          location: field.locationName,
          formManagerNodeId: field.formManagerNoDataNodeID,
          presetValueDefinitionId: field.presetValueDefinitionID,
          resourceId: null,
          possibleValues: [],
          bindingPath: null // Will be filled from layouts
        }
        
        // Try to find resource mapping for dropdowns
        if (field.type === 'SingleSelect' || field.type === 'MultiSelect') {
          // The BindingPathEntryID (bpID) IS the resource group ID!
          const resourceId = field.bpID || field.bindingPathEntryId
          
          // Check if there's a resource group for this field
          if (resourceId && resources) {
            // Check in direct resources first
            if (resources[resourceId]) {
              fieldMap[fieldId].resourceId = resourceId
              
              // Extract the possible values directly
              if (resources[resourceId].Elements) {
                fieldMap[fieldId].possibleValues = resources[resourceId].Elements.map((elem: any) => ({
                  id: elem.Id,
                  value: elem.Value,
                  text: elem.OriginalDisplayMember || elem.Value,
                  order: elem.SortOrder || 0
                }))
              }
            } else {
              // Check in nested resources (1, 2, etc.)
              for (const topKey in resources) {
                if (resources[topKey] && resources[topKey][resourceId]) {
                  fieldMap[fieldId].resourceId = resourceId
                  
                  if (resources[topKey][resourceId].Elements) {
                    fieldMap[fieldId].possibleValues = resources[topKey][resourceId].Elements.map((elem: any) => ({
                      id: elem.Id,
                      value: elem.Value,
                      text: elem.OriginalDisplayMember || elem.Value,
                      order: elem.SortOrder || 0
                    }))
                  }
                  break
                }
              }
            }
          }
        }
        
        fieldMap[fieldId].possibleValues = fieldMap[fieldId].possibleValues
      })
      
      console.log(`[CareSwift] Extracted ${Object.keys(fieldMap).length} fields from dictionary`)
    }
    
    // ALWAYS traverse layouts to get BindingPaths
    if (!layouts) {
      console.log('[CareSwift] No layouts found')
      return Object.values(fieldMap)
    }
    
    // Traverse Forms within layouts
    const traverseForms = (layout: any) => {
      if (!layout) return
      
      // Check for Forms array
      if (layout.Forms && Array.isArray(layout.Forms)) {
        console.log(`[CareSwift] Found ${layout.Forms.length} forms in layout`)
        
        layout.Forms.forEach((form: any, formIndex: number) => {
          console.log(`[CareSwift] Processing form ${formIndex}: ${form.Name || 'Unnamed'}`)
          
          // Process panels within forms
          if (form.Panels && Array.isArray(form.Panels)) {
            form.Panels.forEach((panel: any) => {
              traverseControls(panel.Controls, `Form[${formIndex}]/Panel[${panel.Name}]`)
            })
          }
          
          // Process direct controls
          if (form.Controls && Array.isArray(form.Controls)) {
            traverseControls(form.Controls, `Form[${formIndex}]`)
          }
        })
      }
      
      // Also check for direct panels/sections
      if (layout.Panels) {
        layout.Panels.forEach((panel: any) => {
          traverseControls(panel.Controls, `Panel[${panel.Name}]`)
        })
      }
    }
    
    // Traverse controls recursively
    const traverseControls = (controls: any, path: string, depth: number = 0) => {
      if (!controls || !Array.isArray(controls) || depth > 10) return
      
      controls.forEach((control: any) => {
        if (control.BindingPathEntryID) {
          const fieldId = control.BindingPathEntryID
          
          // If field exists in map, update it with BindingPath
          if (fieldMap[fieldId]) {
            fieldMap[fieldId].bindingPath = control.BindingPath
            fieldMap[fieldId].controlType = control.ControlType
            fieldMap[fieldId].required = win.ko?.unwrap(control.Required)
            fieldMap[fieldId].resourceGroupId = control.ResourceGroupID
            // Determine if this is a collection field dynamically
            const isCollectionField = (
              // Check for grid-like controls (any type containing 'Grid')
              (control.ControlType && control.ControlType.toLowerCase().includes('grid')) ||
              // Check for multi-select controls
              control.ControlType === 'MultiSelect' ||
              // Check for array notation in binding path
              (control.BindingPath && control.BindingPath.includes('[]')) ||
              // Check metadata hints
              control.IsRepeating || 
              control.IsCollection ||
              // Check if MaxCardinality exists and is > 1
              (control.MaxCardinality && control.MaxCardinality > 1)
            )
            
            fieldMap[fieldId].constraints = {
              minLength: control.MinLength,
              maxLength: control.MaxLength,
              min: control.MinValue,
              max: control.MaxValue,
              pattern: control.Pattern,
              mask: control.Mask,
              defaultValue: control.DefaultValue,
              // NEMSIS constraints
              minOccurs: control.IsRequired ? 1 : 0,
              maxOccurs: isCollectionField ? -1 : 1,
              nillable: !!control.FormManagerNoDataNodeID
            }
            fieldMap[fieldId].metadata = {
              isRepeating: control.IsRepeating,
              isCollection: control.IsCollection,
              displayOrder: control.DisplayOrder,
              columnSpan: control.ColumnSpan
            }
          } else {
            // Field not in dictionary, create new entry
            fieldMap[fieldId] = {
              id: fieldId,
              bindingPath: control.BindingPath,
              path: path + '/' + (control.Name || control.Label || 'field'),
              type: control.ControlType,
              label: win.ko?.unwrap(control.Label),
              required: win.ko?.unwrap(control.Required),
              resourceGroupId: control.ResourceGroupID,
              // Determine if this is a collection field dynamically
              constraints: (() => {
                const isCollectionField = (
                  // Check for grid-like controls (any type containing 'Grid')
                  (control.ControlType && control.ControlType.toLowerCase().includes('grid')) ||
                  // Check for multi-select controls
                  control.ControlType === 'MultiSelect' ||
                  // Check for array notation in binding path
                  (control.BindingPath && control.BindingPath.includes('[]')) ||
                  // Check metadata hints
                  control.IsRepeating || 
                  control.IsCollection ||
                  // Check if MaxCardinality exists and is > 1
                  (control.MaxCardinality && control.MaxCardinality > 1)
                )
                
                return {
                  minLength: control.MinLength,
                  maxLength: control.MaxLength,
                  min: control.MinValue,
                  max: control.MaxValue,
                  pattern: control.Pattern,
                  mask: control.Mask,
                  defaultValue: control.DefaultValue,
                  // NEMSIS constraints
                  minOccurs: control.IsRequired ? 1 : 0,
                  maxOccurs: isCollectionField ? -1 : 1,
                  nillable: !!control.FormManagerNoDataNodeID
                }
              })(),
              metadata: {
                isRepeating: control.IsRepeating,
                isCollection: control.IsCollection,
                displayOrder: control.DisplayOrder,
                columnSpan: control.ColumnSpan
              }
            }
          }
        }
        
        // Recurse through child controls
        if (control.Controls) {
          traverseControls(control.Controls, path + '/' + (control.Name || 'group'), depth + 1)
        }
      })
    }
    
    // Process layouts
    if (Array.isArray(layouts)) {
      console.log(`[CareSwift] Processing ${layouts.length} layouts`)
      layouts.forEach((layout: any) => traverseForms(layout))
    } else if (typeof layouts === 'object') {
      console.log('[CareSwift] Processing single layout object')
      traverseForms(layouts)
    }
    
    const fieldsArray = Object.values(fieldMap)
    console.log(`[CareSwift] Total extracted fields: ${fieldsArray.length}`)
    console.log(`[CareSwift] Fields with BindingPath: ${fieldsArray.filter((f: any) => f.bindingPath).length}`)
    return fieldsArray
  }

  // Extract resource groups (enums)
  const extractResourceGroups = (resources: any): any[] => {
    const groups: any[] = []
    
    if (!resources) {
      console.log('[CareSwift] No agencyResources found')
      return groups
    }
    
    // Resources are organized in a nested structure
    // Top level has "1", "2", and GUID keys
    // Inside "1" and "2" are the actual resource groups
    
    for (const topKey in resources) {
      const topLevel = resources[topKey]
      
      if (!topLevel || typeof topLevel !== 'object') continue
      
      // Check if this is a direct resource group (has Elements array)
      if (topLevel.Elements && Array.isArray(topLevel.Elements)) {
        // This is a direct resource group (like the GUID ones)
        const resourceGroup = {
          id: topKey,
          name: topLevel.Elements[0]?.ResourceGroupID || topKey,
          elements: topLevel.Elements.map((elem: any) => ({
            id: elem.Id || elem.ID,
            value: elem.Value,
            text: elem.OriginalDisplayMember || elem.Value,
            order: elem.SortOrder || elem.Order || 0
          }))
        }
        groups.push(resourceGroup)
      } else {
        // This is a container (like "1" or "2"), iterate through its children
        for (const nestedKey in topLevel) {
          const nestedGroup = topLevel[nestedKey]
          
          if (nestedGroup && nestedGroup.Elements && Array.isArray(nestedGroup.Elements)) {
            const resourceGroup = {
              id: nestedKey,
              name: nestedGroup.Elements[0]?.ResourceGroupID || nestedKey,
              elements: nestedGroup.Elements.map((elem: any) => ({
                id: elem.Id || elem.ID,
                value: elem.Value,
                text: elem.OriginalDisplayMember || elem.Value,
                order: elem.SortOrder || elem.Order || 0
              }))
            }
            groups.push(resourceGroup)
          }
        }
      }
    }
    
    console.log(`[CareSwift] Extracted ${groups.length} resource groups with ${groups.filter(g => g.elements.length > 0).length} having elements`)
    return groups
  }

  // Extract validation and visibility rules
  const extractRules = (validations: any, visibilities: any): any[] => {
    const rules: any[] = []
    
    // Unwrap if these are observables
    const unwrappedValidations = win.ko?.isObservable(validations) ? win.ko.unwrap(validations) : validations
    const unwrappedVisibilities = win.ko?.isObservable(visibilities) ? win.ko.unwrap(visibilities) : visibilities
    
    // Process validation rules (they're arrays, not objects)
    if (Array.isArray(unwrappedValidations)) {
      unwrappedValidations.forEach((rule: any) => {
        if (rule && rule.ActionType === 'Validation') {
          rules.push({
            type: 'validation',
            id: rule.ActionID,
            name: rule.Name,
            targetField: rule.AffectedBindingPathEntryID,
            errorMessage: rule.ErrorMessage,
            points: rule.Points,
            expression: normalizeExpression(rule.ExpressionGroup)
          })
        }
      })
    }
    
    // Process visibility rules
    if (Array.isArray(unwrappedVisibilities)) {
      unwrappedVisibilities.forEach((rule: any) => {
        if (rule && rule.ActionType === 'Visibility') {
          rules.push({
            type: 'visibility',
            id: rule.ActionID,
            targetField: rule.FieldNodeID || rule.AffectedFormHierarchyId,
            componentType: rule.ComponentType,
            expression: normalizeExpression(rule.ExpressionGroup)
          })
        }
      })
    }
    
    return rules
  }

  // Normalize expression trees
  const normalizeExpression = (expr: any): any => {
    if (!expr) return null
    
    return {
      booleanOperator: expr.BooleanOperatorID,
      expressions: expr.Expressions?.map((exp: any) => ({
        leftTerm: exp.LeftTermGroup?.Terms?.[0] ? {
          fieldId: exp.LeftTermGroup.Terms[0].BindingPathEntryID,
          path: exp.LeftTermGroup.Terms[0].PathFromParentList,
          value: exp.LeftTermGroup.Terms[0].Value
        } : null,
        rightTerm: exp.RightTermGroup?.Terms ? {
          values: exp.RightTermGroup.Terms.map((t: any) => t.Value),
          operator: exp.RightTermGroup.CalculationOperatorID
        } : null,
        operator: exp.ExpressionOperatorID
      })),
      childGroups: expr.ChildExpressionGroups?.map((group: any) => normalizeExpression(group))
    }
  }

  // Extract repeater metadata
  const extractRepeaters = (layouts: any): any[] => {
    const repeaters: any[] = []
    
    const findRepeaters = (node: any, path: string = '') => {
      if (!node) return
      
      if (node.IsRepeating || node.ControlType === 'Repeater') {
        repeaters.push({
          id: node.ID,
          path: path + '/' + node.Name,
          childBindings: node.Controls?.map((c: any) => c.BindingPathEntryID)
        })
      }
      
      // Recurse
      if (node.Controls) {
        win.ko.unwrap(node.Controls)?.forEach((child: any) => 
          findRepeaters(child, path + '/' + node.Name))
      }
    }
    
    layouts?.forEach((layout: any) => findRepeaters(layout))
    return repeaters
  }

  // Extract FormActions (validation rules from vmObservable)
  const extractFormActions = (formActions: any): any => {
    if (!formActions) {
      console.log('[CareSwift] No FormActions found')
      return null
    }
    
    const extractedActions: any = {}
    
    // Process each path in FormActions
    Object.keys(formActions).forEach(path => {
      console.log(`[CareSwift] Processing FormActions for ${path}: ${formActions[path].length} actions`)
      
      // Extract all properties from each action dynamically
      extractedActions[path] = formActions[path].map((action: any) => {
        // Create a complete copy of the action with all properties
        const extracted: any = {}
        
        // Dynamically copy all properties
        for (const key in action) {
          if (action.hasOwnProperty(key)) {
            // Don't try to unwrap non-observables
            if (win.ko?.isObservable(action[key])) {
              extracted[key] = win.ko.unwrap(action[key])
            } else {
              extracted[key] = action[key]
            }
          }
        }
        
        return extracted
      })
    })
    
    const totalActions = Object.values(extractedActions).flat().length
    console.log(`[CareSwift] Extracted ${totalActions} total FormActions`)
    
    return extractedActions
  }

  // Analyze operators from FormActions
  const analyzeOperators = (formActions: any): any => {
    if (!formActions) return null
    
    const operatorAnalysis = {
      expression: [] as number[],
      boolean: [] as number[],
      calculation: [] as number[]
    }
    
    const expressionOps = new Set<number>()
    const booleanOps = new Set<number>()
    const calculationOps = new Set<number>()
    
    // Go through all actions to collect operators
    Object.values(formActions).flat().forEach((action: any) => {
      if (action.ExpressionGroup) {
        // Recursive function to analyze expressions
        const analyzeExpression = (expr: any) => {
          if (!expr) return
          
          // Boolean operators
          if (expr.BooleanOperatorID !== undefined && expr.BooleanOperatorID !== null) {
            booleanOps.add(expr.BooleanOperatorID)
          }
          
          // Expression operators
          if (expr.Expressions) {
            expr.Expressions.forEach((exp: any) => {
              if (exp.ExpressionOperatorID !== undefined && exp.ExpressionOperatorID !== null) {
                expressionOps.add(exp.ExpressionOperatorID)
              }
              
              // Calculation operators in term groups
              if (exp.LeftTermGroup?.CalculationOperatorID !== undefined) {
                calculationOps.add(exp.LeftTermGroup.CalculationOperatorID)
              }
              if (exp.RightTermGroup?.CalculationOperatorID !== undefined) {
                calculationOps.add(exp.RightTermGroup.CalculationOperatorID)
              }
            })
          }
          
          // Recurse for child groups
          if (expr.ChildExpressionGroups) {
            expr.ChildExpressionGroups.forEach(analyzeExpression)
          }
        }
        
        analyzeExpression(action.ExpressionGroup)
      }
    })
    
    operatorAnalysis.expression = Array.from(expressionOps).sort((a, b) => a - b)
    operatorAnalysis.boolean = Array.from(booleanOps).sort((a, b) => a - b)
    operatorAnalysis.calculation = Array.from(calculationOps).sort((a, b) => a - b)
    
    console.log('[CareSwift] Operator analysis:', {
      expressionOperators: operatorAnalysis.expression.length,
      booleanOperators: operatorAnalysis.boolean.length,
      calculationOperators: operatorAnalysis.calculation.length
    })
    
    return operatorAnalysis
  }

  // Initialize
  checkForImageTrend()
}