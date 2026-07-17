import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Anchor, Code } from '../ds';
import { prose, preWrapper } from './MarkdownContent.styles';

export function MarkdownContent({ content }: { content: string }) {
  return (
    <div className={prose}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <Anchor
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              size="sm"
            >
              {children}
            </Anchor>
          ),
          code: ({ className, children, ...props }) => {
            const text = String(children).replace(/\n$/, '');
            const isBlock = Boolean(className) || text.includes('\n');
            if (isBlock) {
              return (
                <Code block className={className} {...props}>
                  {text}
                </Code>
              );
            }
            return <Code {...props}>{children}</Code>;
          },
          pre: ({ children }) => <div className={preWrapper}>{children}</div>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
