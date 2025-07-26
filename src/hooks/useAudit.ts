import { useState } from 'react';

interface Finding {
  vulnerabilityName: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low' | 'Informational';
  impact: string;
  vulnerableCode: string;
  explanation: string;
  proofOfConcept: string;
  remediation: string;
  references?: string;
  cveId?: string;
  swcId?: string;
}

interface AuditSummary {
  totalFindings: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  informationalCount: number;
  riskScore: number;
  overallRisk: 'Critical' | 'High' | 'Medium' | 'Low' | 'Minimal';
}

interface Message {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  findings?: Finding[];
  summary?: AuditSummary;
  timestamp: Date;
}

export function useAudit() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const calculateAuditSummary = (findings: Finding[]): AuditSummary => {
    const criticalCount = findings.filter(f => f.severity === 'Critical').length;
    const highCount = findings.filter(f => f.severity === 'High').length;
    const mediumCount = findings.filter(f => f.severity === 'Medium').length;
    const lowCount = findings.filter(f => f.severity === 'Low').length;
    const informationalCount = findings.filter(f => f.severity === 'Informational').length;

    // Calculate risk score (weighted by severity)
    const riskScore = (criticalCount * 10) + (highCount * 7) + (mediumCount * 4) + (lowCount * 2) + (informationalCount * 1);
    
    let overallRisk: 'Critical' | 'High' | 'Medium' | 'Low' | 'Minimal' = 'Minimal';
    if (criticalCount > 0) overallRisk = 'Critical';
    else if (highCount > 0) overallRisk = 'High';
    else if (mediumCount > 2) overallRisk = 'High';
    else if (mediumCount > 0 || lowCount > 3) overallRisk = 'Medium';
    else if (lowCount > 0) overallRisk = 'Low';

    return {
      totalFindings: findings.length,
      criticalCount,
      highCount,
      mediumCount,
      lowCount,
      informationalCount,
      riskScore,
      overallRisk
    };
  };

  const parseAuditResponse = (response: string): Finding[] => {
    const findings: Finding[] = [];
    
    // Helper function to extract content and remove it from the source text
    const extractAndRemoveBlock = (text: string, patterns: RegExp[]): { extracted: string; remaining: string } => {
      let extracted = '';
      let remaining = text;
      
      for (const pattern of patterns) {
        const match = remaining.match(pattern);
        if (match) {
          extracted = match[1] ? match[1].trim() : match[0].trim();
          // Remove the entire matched block from the text
          remaining = remaining.replace(pattern, '').trim();
          break;
        }
      }
      
      return { extracted, remaining };
    };
    
    // Check if no vulnerabilities were found
    if (response.includes('✅ AUDIT REPORT') && response.includes('✅ CONCLUSION') && 
        (response.includes('No vulnerabilities detected') || response.includes('No significant issues'))) {
      return [{
        vulnerabilityName: 'Security Audit Complete',
        severity: 'Informational',
        impact: 'No security vulnerabilities detected in the analyzed smart contract code.',
        vulnerableCode: '',
        explanation: response,
        proofOfConcept: '',
        remediation: 'No action required - contract follows security best practices',
        references: ''
      }];
    }
    
    // Check for legacy format
    if (response.includes('## AUDIT COMPLETE') || 
        response.includes('No significant vulnerabilities detected') ||
        response.includes('no vulnerabilities found') ||
        response.includes('appears to be secure') ||
        response.includes('no major security issues')) {
      return [{
        vulnerabilityName: 'Security Audit Complete',
        severity: 'Informational',
        impact: 'No security vulnerabilities detected in the analyzed smart contract code.',
        vulnerableCode: '',
        explanation: response,
        proofOfConcept: '',
        remediation: 'No action required - contract follows security best practices',
        references: ''
      }];
    }
    
    // Enhanced parsing for multiple finding formats - prioritize new format
    let findingSections: string[] = [];
    
    // Pattern 1: New structured format with ## FINDING
    if (response.match(/## FINDING \d+:/)) {
      findingSections = response.split(/(?=## FINDING \d+:)/);
    }
    // Pattern 2: Alternative FINDING headers
    else if (response.match(/(?:## FINDING|# FINDING|FINDING \d+|Finding \d+)/i)) {
      findingSections = response.split(/(?=(?:## FINDING|# FINDING|FINDING \d+|Finding \d+))/i);
    }
    // Pattern 3: Look for numbered findings with various formats
    else if (response.match(/(?:^|\n)\s*(?:\d+\.|##\s*\d+\.|#\s*\d+\.|\*\*\d+\.\*\*)\s*[A-Z]/m)) {
      findingSections = response.split(/(?=(?:^|\n)\s*(?:\d+\.|##\s*\d+\.|#\s*\d+\.|\*\*\d+\.\*\*)\s*[A-Z])/m);
    }
    // Pattern 4: Look for vulnerability sections with "Vulnerability Name/Type:"
    else if (response.includes('Vulnerability Name/Type:')) {
      findingSections = response.split(/(?=Vulnerability Name\/Type:)/i);
    }
    // Pattern 5: Look for severity-based sections
    else if (response.match(/(?:Critical|High|Medium|Low)\s*Severity/i)) {
      findingSections = response.split(/(?=(?:Critical|High|Medium|Low)\s*Severity)/i);
    }
    // Pattern 6: Split by vulnerability indicators
    else if (response.match(/(?:Vulnerability|Issue|Problem|Risk).*?:/i)) {
      findingSections = response.split(/(?=(?:Vulnerability|Issue|Problem|Risk).*?:)/i);
    }
    // Fallback: treat entire response as one finding
    else {
      findingSections = ['', response];
    }
    
    // Skip the first section (usually intro text) and process each finding
    for (let i = 1; i < findingSections.length; i++) {
      let section = findingSections[i].trim();
      if (!section) continue;
      
      try {
        // Initialize variables for extracted content
        let vulnerabilityName = 'Unknown Vulnerability';
        let severity: Finding['severity'] = 'Medium';
        let impact = '';
        let vulnerableCode = '';
        let explanation = '';
        let proofOfConcept = '';
        let remediation = '';
        let references = '';
        
        // Enhanced vulnerability name extraction
        
        // Pattern 1: New structured format "## FINDING 1: Name"
        const newFormatMatch = section.match(/## FINDING \d+:\s*([^\n]+)/i);
        if (newFormatMatch) {
          vulnerabilityName = newFormatMatch[1].trim();
        }
        // Pattern 2: "Vulnerability Name/Type:" format
        else {
          const vulnNameMatch = section.match(/(?:Vulnerability Name\/Type|Vulnerability|Issue|Problem):\s*([^\n]+)/i);
        if (vulnNameMatch) {
          vulnerabilityName = vulnNameMatch[1].trim();
        }
        // Pattern 3: Numbered section headers
        else {
          const numberedMatch = section.match(/(?:^|\n)\s*(?:\d+\.|##\s*\d+\.|#\s*\d+\.|\*\*\d+\.\*\*)\s*([^\n]+)/);
          if (numberedMatch) {
            vulnerabilityName = numberedMatch[1].trim();
          }
          // Pattern 4: FINDING headers
          else {
            const findingMatch = section.match(/(?:## FINDING|# FINDING|FINDING \d+|Finding \d+):\s*([^\n]+)/i);
            if (findingMatch) {
              vulnerabilityName = findingMatch[1].trim();
            }
            // Pattern 5: First meaningful line
            else {
              const lines = section.split('\n').filter(line => line.trim());
              if (lines.length > 0) {
                let firstLine = lines[0].trim();
                // Clean up common prefixes
                firstLine = firstLine.replace(/^(?:##\s*|#\s*|\*\*|\d+\.\s*|FINDING\s*\d*:?\s*)/i, '');
                if (firstLine.length > 5) {
                  vulnerabilityName = firstLine;
                }
              }
            }
          }
        }
        }
        
        // Clean up vulnerability name
        vulnerabilityName = vulnerabilityName.replace(/^[:\-\s\*]+/, '').replace(/\*\*/g, '').trim();
        
        // STEP 1: Extract and remove Proof of Concept
        const pocPatterns = [
          /\*\*Proof of Concept:\*\*\s*\n?([\s\S]*?)(?=\n\*\*[A-Z]|\n\n|\n---|\n##|$)/s,
          /[•\-\*]\s*(?:Proof of Concept|PoC)(?:\s*\([^)]*\))?:\s*([\s\S]*?)(?=\n\s*[•\-\*]\s*(?:Recommended|References?|Option|$)|\n\n|\n[A-Z]|$)/i,
          /(?:Proof of Concept|PoC)(?:\s*\([^)]*\))?:\s*([\s\S]*?)(?=\n\s*[•\-\*]\s*(?:Recommended|References?|Option|$)|\n(?:[A-Z•\-\*]|$))/i,
          /\*\*(?:Proof of Concept|PoC)(?:\s*\([^)]*\))?\*\*:\s*([\s\S]*?)(?=\n\*\*|\n\n|\n[A-Z]|$)/i
        ];
        
        const pocResult = extractAndRemoveBlock(section, pocPatterns);
        proofOfConcept = pocResult.extracted;
        section = pocResult.remaining;
        
        // STEP 2: Extract and remove Remediation
        const remediationPatterns = [
          /\*\*Recommended Remediation:\*\*\s*\n?([\s\S]*?)(?=\n\*\*[A-Z]|\n\n|\n---|\n##|$)/s,
          /[•\-\*]\s*(?:Recommended Remediation|Remediation|Fix|Solution):\s*([\s\S]*?)(?=\n\s*[•\-\*]\s*(?:References?|Option|$)|\n\n|\n[A-Z]|$)/i,
          /(?:Recommended Remediation|Remediation|Fix|Solution):\s*([\s\S]*?)(?=\n\s*[•\-\*]\s*(?:References?|Option|$)|\n(?:[A-Z•\-\*]|$))/i,
          /\*\*(?:Recommended Remediation|Remediation|Fix|Solution)\*\*:\s*([\s\S]*?)(?=\n\*\*|\n\n|\n[A-Z]|$)/i
        ];
        
        const remediationResult = extractAndRemoveBlock(section, remediationPatterns);
        remediation = remediationResult.extracted;
        section = remediationResult.remaining;
        
        // STEP 3: Extract and remove References
        const referencesPatterns = [
          /\*\*References:\*\*\s*\n?([\s\S]*?)(?=\n\*\*[A-Z]|\n\n|\n---|\n##|$)/s,
          /[•\-\*]\s*(?:References?|Links|Resources):\s*([\s\S]*?)(?=\n\s*[•\-\*]|\n\n|\n[A-Z]|$)/i,
          /(?:References?|Links|Resources):\s*([\s\S]*?)(?=\n(?:[A-Z•\-\*]|$))/i,
          /\*\*(?:References?|Links|Resources)\*\*:\s*([\s\S]*?)(?=\n\*\*|\n\n|\n[A-Z]|$)/i
        ];
        
        const referencesResult = extractAndRemoveBlock(section, referencesPatterns);
        references = referencesResult.extracted;
        section = referencesResult.remaining;
        
        // STEP 4: Extract and remove Impact
        const impactPatterns = [
          /\*\*Impact:\*\*\s*\n?([\s\S]*?)(?=\n\*\*[A-Z]|\n\n|\n---|\n##|$)/s,
          /(?:^|\n)\s*Impact:\s*([^\n]+?)(?=\n(?:[A-Z]|$))/s,
          /[•\-\*]\s*Impact:\s*([^\n•\-\*]+?)(?=\n[•\-\*]|\n\n|\n[A-Z]|$)/s,
          /\*\*Impact\*\*:\s*([^\n]+?)(?=\n\*\*|\n\n|\n[A-Z]|$)/s
        ];
        
        const impactResult = extractAndRemoveBlock(section, impactPatterns);
        impact = impactResult.extracted;
        section = impactResult.remaining;
        
        // STEP 5: Extract and remove Vulnerable Code
        const codePatterns = [
          /\*\*Vulnerable Code:\*\*\s*\n?```[\w]*\n?([\s\S]*?)\n?```/,
          /```[\w]*\n?([\s\S]*?)\n?```/,
          /(?:Vulnerable Code Snippet|Code Snippet|Vulnerable Code):\s*\n?([\s\S]*?)(?=\n(?:[A-Z•\-\*]|$))/i,
          /[•\-\*]\s*(?:Vulnerable Code Snippet|Code):\s*\n?([\s\S]*?)(?=\n[•\-\*]|\n\n|\n[A-Z]|$)/i
        ];
        
        const codeResult = extractAndRemoveBlock(section, codePatterns);
        vulnerableCode = codeResult.extracted;
        section = codeResult.remaining;
        
        // Enhanced severity extraction with comprehensive patterns
        
        // Pattern 1: New structured format **Severity:** High
        const structuredSeverityMatch = section.match(/\*\*Severity:\*\*\s*(Critical|High|Medium|Low|Informational)/i);
        if (structuredSeverityMatch) {
          severity = structuredSeverityMatch[1] as Finding['severity'];
        }
        // Pattern 2: Direct severity statements
        else {
          const directSeverityMatch = section.match(/(?:^|\n)\s*(?:Severity|Risk Level|Priority):\s*(Critical|High|Medium|Low|Informational)/i);
        if (directSeverityMatch) {
          severity = directSeverityMatch[1] as Finding['severity'];
        }
        // Pattern 3: Bullet point format
        const bulletSeverityMatch = section.match(/[•\-\*]\s*(?:Severity|Risk Level|Priority):\s*(Critical|High|Medium|Low|Informational)/i);
        if (bulletSeverityMatch) {
          severity = bulletSeverityMatch[1] as Finding['severity'];
        }
        // Pattern 4: Alternative structured format
        else {
          const altStructuredMatch = section.match(/\*\*(?:Severity|Risk Level|Priority)\*\*:\s*(Critical|High|Medium|Low|Informational)/i);
          if (altStructuredMatch) {
            severity = altStructuredMatch[1] as Finding['severity'];
          }
          // Pattern 5: Severity in section headers
          else {
            const headerSeverityMatch = section.match(/(?:Critical|High|Medium|Low|Informational)\s*(?:Severity|Risk|Priority|Vulnerability)/i);
            if (headerSeverityMatch) {
              const severityText = headerSeverityMatch[0].match(/(Critical|High|Medium|Low|Informational)/i);
              if (severityText) {
                severity = severityText[1] as Finding['severity'];
              }
            }
            // Pattern 6: Content-based detection with better keywords
            else {
              const lowerSection = section.toLowerCase();
              if (lowerSection.includes('critical vulnerability') || lowerSection.includes('critical risk') || lowerSection.includes('critical severity')) {
                severity = 'Critical';
              } else if (lowerSection.includes('high vulnerability') || lowerSection.includes('high risk') || lowerSection.includes('high severity')) {
                severity = 'High';
              } else if (lowerSection.includes('medium vulnerability') || lowerSection.includes('medium risk') || lowerSection.includes('medium severity')) {
                severity = 'Medium';
              } else if (lowerSection.includes('low vulnerability') || lowerSection.includes('low risk') || lowerSection.includes('low severity')) {
                severity = 'Low';
              } else if (lowerSection.includes('informational') || lowerSection.includes('info')) {
                severity = 'Informational';
              }
            }
          }
        }
        }
        
        // STEP 6: Extract explanation from remaining content
        // After all specific sections have been removed, what remains should be the core explanation
        
        // First try to find a structured Technical Analysis section
        const explanationPatterns = [
          /\*\*Technical Analysis:\*\*\s*\n?([\s\S]*?)(?=\n\*\*[A-Z]|\n\n|\n---|\n##|$)/s,
          /(?:Detailed Explanation|Technical Analysis|Explanation|Description):\s*([\s\S]*?)(?=\n\s*[•\-\*]\s*(?:Proof of Concept|Recommended|References?|Option|$)|\n(?:[A-Z•\-\*]|$))/i,
          /[•\-\*]\s*(?:Detailed Explanation|Technical Analysis|Explanation):\s*([\s\S]*?)(?=\n\s*[•\-\*]\s*(?:Proof of Concept|Recommended|References?|Option|$)|\n\n|\n[A-Z]|$)/i,
          /\*\*(?:Detailed Explanation|Technical Analysis|Explanation)\*\*:\s*([\s\S]*?)(?=\n\s*\*\*(?:Proof of Concept|Recommended|References?|$)|\n\*\*|\n\n|\n[A-Z]|$)/i
        ];
        
        const explanationResult = extractAndRemoveBlock(section, explanationPatterns);
        if (explanationResult.extracted) {
          explanation = explanationResult.extracted;
          section = explanationResult.remaining;
        }
        
        // If no structured explanation found, use the remaining content after all extractions
        if (!explanation || explanation.length < 30) {
          // Clean up the remaining section content
          let remainingContent = section
            .replace(/^[•\-\*\s]+/gm, '') // Remove bullet points
            .replace(/^\s*[\-\*]\s*/gm, '') // Remove list markers
            .replace(/\n\s*\n\s*\n/g, '\n\n') // Clean up extra newlines
            .replace(/^(## FINDING \d+:|FINDING \d+:|Finding \d+:).*$/gm, '') // Remove finding headers
            .replace(/^\s*Severity:\s*\w+\s*$/gm, '') // Remove standalone severity lines
            .replace(/^\s*Impact:\s*$/gm, '') // Remove empty impact headers
            .replace(/^\s*References?:\s*$/gm, '') // Remove empty reference headers
            .replace(/^\s*Proof of Concept:\s*$/gm, '') // Remove empty PoC headers
            .replace(/^\s*Recommended Remediation:\s*$/gm, '') // Remove empty remediation headers
            .trim();
          
          if (remainingContent && remainingContent.length > 20) {
            explanation = remainingContent;
          }
        }
        
        // Clean up all extracted content
        if (vulnerableCode) {
          vulnerableCode = vulnerableCode
            .replace(/^[•\-\*\s]+/gm, '')
            .replace(/^\s*[\-\*]\s*/gm, '')
            .trim();
        }
        
        if (proofOfConcept) {
          proofOfConcept = proofOfConcept
            .replace(/^[•\-\*\s]+/gm, '')
            .replace(/^\s*[\-\*]\s*/gm, '')
            .trim();
        }
        
        if (remediation) {
          remediation = remediation
            .replace(/^[•\-\*\s]+/gm, '')
            .replace(/^\s*[\-\*]\s*/gm, '')
            .trim();
        }
        
        if (references) {
          references = references
            .replace(/^[•\-\*\s]+/gm, '')
            .replace(/^\s*[\-\*]\s*/gm, '')
            .trim();
        }
        
        if (impact) {
          impact = impact
            .replace(/^[•\-\*\s]+/gm, '')
            .replace(/^\s*[\-\*]\s*/gm, '')
            .trim();
        }
        
        if (explanation) {
          explanation = explanation
            .replace(/^[•\-\*\s]+/gm, '')
            .replace(/^\s*[\-\*]\s*/gm, '')
            .trim();
        }
        
        // Extract CVE and SWC IDs from the original section
        const originalSection = findingSections[i];
        const cveMatch = originalSection.match(/CVE-\d{4}-\d+/i);
        const cveId = cveMatch?.[0];
        
        const swcMatch = originalSection.match(/SWC-\d+/i);
        const swcId = swcMatch?.[0];
        
        // Only add finding if it has meaningful content and proper vulnerability name
        if (vulnerabilityName && 
            vulnerabilityName !== 'Unknown Vulnerability' && 
            vulnerabilityName.length > 5 &&
            !vulnerabilityName.toLowerCase().includes('audit report')) {
          findings.push({
            vulnerabilityName,
            severity,
            impact,
            vulnerableCode,
            explanation,
            proofOfConcept,
            remediation,
            references,
            cveId,
            swcId
          });
        }
      } catch (error) {
        console.error('Error parsing finding:', error);
        // Only add fallback if section has meaningful content
        if (section.length > 100) {
          findings.push({
            vulnerabilityName: 'Manual Review Required',
            severity: 'Medium',
            impact: '',
            vulnerableCode: '',
            explanation: section,
            proofOfConcept: '',
            remediation: '',
            references: ''
          });
        }
      }
    }
    
    // If no findings were parsed but response exists and looks like it has vulnerabilities
    if (findings.length === 0 && response.trim() && 
        (response.toLowerCase().includes('vulnerability') || 
         response.toLowerCase().includes('risk') || 
         response.toLowerCase().includes('issue'))) {
      return [{
        vulnerabilityName: 'Security Analysis Required',
        severity: 'Medium',
        impact: '',
        vulnerableCode: '',
        explanation: response,
        proofOfConcept: '',
        remediation: '',
        references: ''
      }];
    }
    
    return findings;
  };

  const performAudit = async (code: string, description: string, fileName?: string, fileCount?: number) => {
    setIsLoading(true);
    
    // Add user message
    let codeDisplay;
    if (fileName && fileCount && fileCount > 1) {
      codeDisplay = `**Uploaded Files:** ${fileName}\n\n**Smart Contract Code:**\n\`\`\`solidity\n${code}\n\`\`\``;
    } else if (fileName) {
      codeDisplay = `**Uploaded File:** \`${fileName}\`\n\n**Smart Contract Code:**\n\`\`\`solidity\n${code}\n\`\`\``;
    } else {
      codeDisplay = `**Smart Contract Code:**\n\`\`\`solidity\n${code}\n\`\`\``;
    }
    
    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: `${description ? `**Contract Description:** ${description}\n\n` : ''}${codeDisplay}`,
      timestamp: new Date()
    };
    
    setMessages(prev => [...prev, userMessage]);
    
    try {
      // Check if environment variables are configured
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      
      if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes('your-project-ref')) {
        throw new Error('Supabase environment variables are not configured. Please set up your Supabase project and update the .env file with your actual project URL and anonymous key.');
      }
      
      // Call Supabase edge function
      const response = await fetch(`${supabaseUrl}/functions/v1/audit-contract`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code,
          description
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: Failed to get audit response`);
      }
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Audit request failed');
      }
      
      const auditResult = data.audit || 'Unable to complete audit analysis.';
      
      // Parse findings from the response
      const findings = parseAuditResponse(auditResult);
      const summary = calculateAuditSummary(findings);
      
      // Create appropriate message based on actual findings severity
      let messageContent = '';
      if (findings.length > 0) {
        const criticalIssues = findings.filter(f => f.severity === 'Critical').length;
        const highIssues = findings.filter(f => f.severity === 'High').length;
        const mediumIssues = findings.filter(f => f.severity === 'Medium').length;
        const lowIssues = findings.filter(f => f.severity === 'Low').length;
        
        if (criticalIssues > 0) {
          messageContent = `🚨 **Critical Security Issues Detected** - Found ${findings.length} total issue${findings.length > 1 ? 's' : ''} including ${criticalIssues} critical vulnerabilit${criticalIssues > 1 ? 'ies' : 'y'}. Immediate action required.`;
        } else if (highIssues > 0) {
          messageContent = `⚠️ **High-Risk Vulnerabilities Found** - Identified ${findings.length} security issue${findings.length > 1 ? 's' : ''} including ${highIssues} high-severity vulnerabilit${highIssues > 1 ? 'ies' : 'y'}. Please review and address promptly.`;
        } else if (mediumIssues > 0) {
          messageContent = `⚠️ **Medium-Risk Issues Detected** - Found ${findings.length} security issue${findings.length > 1 ? 's' : ''} including ${mediumIssues} medium-severity vulnerabilit${mediumIssues > 1 ? 'ies' : 'y'}. Review recommended.`;
        } else if (lowIssues > 0) {
          messageContent = `ℹ️ **Low-Risk Issues Found** - Identified ${findings.length} low-severity issue${findings.length > 1 ? 's' : ''} for review. Consider addressing for best practices.`;
        } else {
          messageContent = `✅ **Security Audit Complete** - Found ${findings.length} informational item${findings.length > 1 ? 's' : ''} for review.`;
        }
      } else {
        messageContent = '✅ **Security Audit Complete** - No major vulnerabilities detected. The contract appears to follow security best practices.';
      }
      
      // Add assistant message
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: messageContent,
        findings: findings.length > 0 ? findings : undefined,
        summary: summary,
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, assistantMessage]);
      
    } catch (error) {
      console.error('Audit error:', error);
      
      // Add error message
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: `❌ **Audit Failed** - ${error instanceof Error ? error.message : 'Unknown error occurred'}. Please check your configuration and try again.`,
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return {
    messages,
    isLoading,
    performAudit
  };
}
        else {
  };

  const performAudit = async (code: string, description: string, fileName?: string, fileCount?: number) => {
    setIsLoading(true);
    
    // Add user message
    let codeDisplay;
    if (fileName && fileCount && fileCount > 1) {
      codeDisplay = `**Uploaded Files:** ${fileName}\n\n**Smart Contract Code:**\n\`\`\`solidity\n${code}\n\`\`\``;
    } else if (fileName) {
      codeDisplay = `**Uploaded File:** \`${fileName}\`\n\n**Smart Contract Code:**\n\`\`\`solidity\n${code}\n\`\`\``;
    } else {
      codeDisplay = `**Smart Contract Code:**\n\`\`\`solidity\n${code}\n\`\`\``;
    }
    
    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: `${description ? `**Contract Description:** ${description}\n\n` : ''}${codeDisplay}`,
      timestamp: new Date()
    };
    
    setMessages(prev => [...prev, userMessage]);
    
    try {
      // Check if environment variables are configured
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      
      if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes('your-project-ref')) {
        throw new Error('Supabase environment variables are not configured. Please set up your Supabase project and update the .env file with your actual project URL and anonymous key.');
      }
      
      // Call Supabase edge function
      const response = await fetch(`${supabaseUrl}/functions/v1/audit-contract`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code,
          description
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: Failed to get audit response`);
      }
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Audit request failed');
      }
      
      const auditResult = data.audit || 'Unable to complete audit analysis.';
      
      // Parse findings from the response
      const findings = parseAuditResponse(auditResult);
      const summary = calculateAuditSummary(findings);
      
      // Create appropriate message based on actual findings severity
      let messageContent = '';
      if (findings.length > 0) {
        const criticalIssues = findings.filter(f => f.severity === 'Critical').length;
        const highIssues = findings.filter(f => f.severity === 'High').length;
        const mediumIssues = findings.filter(f => f.severity === 'Medium').length;
        const lowIssues = findings.filter(f => f.severity === 'Low').length;
        
        if (criticalIssues > 0) {
          messageContent = `🚨 **Critical Security Issues Detected** - Found ${findings.length} total issue${findings.length > 1 ? 's' : ''} including ${criticalIssues} critical vulnerabilit${criticalIssues > 1 ? 'ies' : 'y'}. Immediate action required.`;
        } else if (highIssues > 0) {
          messageContent = `⚠️ **High-Risk Vulnerabilities Found** - Identified ${findings.length} security issue${findings.length > 1 ? 's' : ''} including ${highIssues} high-severity vulnerabilit${highIssues > 1 ? 'ies' : 'y'}. Please review and address promptly.`;
        } else if (mediumIssues > 0) {
          messageContent = `⚠️ **Medium-Risk Issues Detected** - Found ${findings.length} security issue${findings.length > 1 ? 's' : ''} including ${mediumIssues} medium-severity vulnerabilit${mediumIssues > 1 ? 'ies' : 'y'}. Review recommended.`;
        } else if (lowIssues > 0) {
          messageContent = `ℹ️ **Low-Risk Issues Found** - Identified ${findings.length} low-severity issue${findings.length > 1 ? 's' : ''} for review. Consider addressing for best practices.`;
        } else {
          messageContent = `✅ **Security Audit Complete** - Found ${findings.length} informational item${findings.length > 1 ? 's' : ''} for review.`;
        }
      } else {
        messageContent = '✅ **Security Audit Complete** - No major vulnerabilities detected. The contract appears to follow security best practices.';
      }
      
      // Add assistant message
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: messageContent,
        findings: findings.length > 0 ? findings : undefined,
        summary: summary,
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, assistantMessage]);
      
    } catch (error) {
      console.error('Audit error:', error);
      
      // Add error message
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: `❌ **Audit Failed** - ${error instanceof Error ? error.message : 'Unknown error occurred'}. Please check your configuration and try again.`,
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return {
    messages,
    isLoading,
    performAudit
  };
}