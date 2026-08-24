import sys
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN

def create_deck():
    prs = Presentation()
    
    # Configure 16:9 widescreen slides
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    
    # Theme color definitions
    bg_color = RGBColor(15, 23, 42)       # Slate 900 (Dark Navy)
    title_color = RGBColor(45, 212, 191)  # Teal 400 (Cyan accent)
    text_color = RGBColor(241, 245, 249)  # Slate 100 (White text)
    sub_color = RGBColor(148, 163, 184)   # Slate 400 (Grey text)
    accent_color = RGBColor(13, 148, 136) # Teal 600
    
    blank_layout = prs.slide_layouts[6]   # Completely blank layout
    
    def set_slide_background(slide):
        background = slide.background
        fill = background.fill
        fill.solid()
        fill.fore_color.rgb = bg_color

    def add_slide_header(slide, title_text, category_text="RICO CAMERA CAPTURE"):
        # Header category
        txBox = slide.shapes.add_textbox(Inches(0.8), Inches(0.4), Inches(11.7), Inches(0.4))
        tf = txBox.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.text = category_text.upper()
        p.font.size = Pt(10)
        p.font.bold = True
        p.font.color.rgb = sub_color
        p.font.name = 'Arial'
        
        # Main Title
        txBox2 = slide.shapes.add_textbox(Inches(0.8), Inches(0.7), Inches(11.7), Inches(0.8))
        tf2 = txBox2.text_frame
        tf2.word_wrap = True
        p2 = tf2.paragraphs[0]
        p2.text = title_text
        p2.font.size = Pt(28)
        p2.font.bold = True
        p2.font.color.rgb = title_color
        p2.font.name = 'Arial'

    # ==================== SLIDE 1: Title Slide ====================
    s1 = prs.slides.add_slide(blank_layout)
    set_slide_background(s1)
    
    # Title & Subtitle box
    t_box = s1.shapes.add_textbox(Inches(1.0), Inches(1.5), Inches(11.333), Inches(2.2))
    tf = t_box.text_frame
    tf.word_wrap = True
    
    p = tf.paragraphs[0]
    p.text = "RICO CAMERA CAPTURE & STOPPAGE ANALYZER"
    p.font.size = Pt(40)
    p.font.bold = True
    p.font.color.rgb = title_color
    p.font.name = 'Arial'
    
    p2 = tf.add_paragraph()
    p2.text = "AI-Powered Industrial Stoppage Recorder and Voice Log System"
    p2.font.size = Pt(20)
    p2.font.color.rgb = text_color
    p2.font.name = 'Arial'
    p2.space_before = Pt(14)
    
    # Details box
    d_box = s1.shapes.add_textbox(Inches(1.0), Inches(4.2), Inches(11.333), Inches(2.5))
    tf_d = d_box.text_frame
    tf_d.word_wrap = True
    
    bullets = [
        ("Project Goal", "Automate machine stoppage logging and capture operator voice commentary using low-latency video streaming, PLC monitoring, and AI voice transcription."),
        ("Target Environment", "Shop floor / Industrial manufacturing cells."),
        ("Audience", "Senior Leadership Team & Operational Managers.")
    ]
    
    for idx, (label, desc) in enumerate(bullets):
        p_b = tf_d.paragraphs[0] if idx == 0 else tf_d.add_paragraph()
        p_b.space_before = Pt(8)
        
        run1 = p_b.add_run()
        run1.text = f"•   {label}: "
        run1.font.bold = True
        run1.font.size = Pt(14)
        run1.font.color.rgb = title_color
        run1.font.name = 'Arial'
        
        run2 = p_b.add_run()
        run2.text = desc
        run2.font.size = Pt(14)
        run2.font.color.rgb = text_color
        run2.font.name = 'Arial'

    # ==================== SLIDE 2: Problem Statement ====================
    s2 = prs.slides.add_slide(blank_layout)
    set_slide_background(s2)
    add_slide_header(s2, "The Problem Statement & Context")
    
    # Left box: Introduction Text
    left_box = s2.shapes.add_textbox(Inches(0.8), Inches(1.8), Inches(4.5), Inches(4.5))
    tf_l = left_box.text_frame
    tf_l.word_wrap = True
    p_l = tf_l.paragraphs[0]
    p_l.text = "Current Challenges in Stoppage Tracking"
    p_l.font.size = Pt(22)
    p_l.font.bold = True
    p_l.font.color.rgb = text_color
    p_l.font.name = 'Arial'
    
    p_l2 = tf_l.add_paragraph()
    p_l2.text = "Manual logging is inefficient and leads to information gaps, preventing continuous improvement teams from identifying the root cause of frequent machine failures."
    p_l2.font.size = Pt(14)
    p_l2.font.color.rgb = sub_color
    p_l2.font.name = 'Arial'
    p_l2.space_before = Pt(14)
    
    # Right box: Bullets
    right_box = s2.shapes.add_textbox(Inches(5.8), Inches(1.8), Inches(6.8), Inches(4.5))
    tf_r = right_box.text_frame
    tf_r.word_wrap = True
    
    challenges = [
        ("Manual Logging Errors", "Operators often fail to log short stoppages or record inaccurate timestamps due to busy production schedules."),
        ("Lack of Visual Proof", "Supervisors have no way to visually verify what caused a minor stoppage or breakdown after it has occurred."),
        ("High Volume of Minor Events", "Frequent short stoppages (< 2 minutes) are rarely logged, hiding significant cumulative productivity loss."),
        ("Analysis Hurdles", "Typing on factory panels is slow. Operators write generic descriptions (e.g. 'stopped'), omitting critical root causes.")
    ]
    
    for idx, (title, desc) in enumerate(challenges):
        p_c = tf_r.paragraphs[0] if idx == 0 else tf_r.add_paragraph()
        p_c.space_before = Pt(12)
        
        run1 = p_c.add_run()
        run1.text = f"•   {title}\n"
        run1.font.bold = True
        run1.font.size = Pt(15)
        run1.font.color.rgb = title_color
        
        run2 = p_c.add_run()
        run2.text = f"    {desc}"
        run2.font.size = Pt(13)
        run2.font.color.rgb = text_color

    # ==================== SLIDE 3: The Solution Overview ====================
    s3 = prs.slides.add_slide(blank_layout)
    set_slide_background(s3)
    add_slide_header(s3, "The Solution: Automated Camera & Sensor System")
    
    left_box = s3.shapes.add_textbox(Inches(0.8), Inches(1.8), Inches(4.5), Inches(4.5))
    tf_l = left_box.text_frame
    tf_l.word_wrap = True
    p_l = tf_l.paragraphs[0]
    p_l.text = "Visual & Voice-Driven Recording Pipeline"
    p_l.font.size = Pt(22)
    p_l.font.bold = True
    p_l.font.color.rgb = text_color
    
    p_l2 = tf_l.add_paragraph()
    p_l2.text = "By replacing manual inputs with automatic recording and voice transcription, the shop floor gets a foolproof audit log with zero overhead for the operator."
    p_l2.font.size = Pt(14)
    p_l2.font.color.rgb = sub_color
    p_l2.space_before = Pt(14)
    
    right_box = s3.shapes.add_textbox(Inches(5.8), Inches(1.8), Inches(6.8), Inches(4.5))
    tf_r = right_box.text_frame
    tf_r.word_wrap = True
    
    sol_steps = [
        ("PLC Trigger Sensor Connection", "The machine's PLC triggers video recording automatically during stoppage events (e.g. when safety gate is opened)."),
        ("Asynchronous Zero-Transcoding Video", "Low-overhead recording stores direct feeds from RTSP cameras to disk instantly, using < 2% CPU."),
        ("Microphone Voice Logs", "Instead of typing on keyboards, operators record a quick voice explanation right from the console."),
        ("AI Whisper Translation & Transcription", "An integrated Whisper model converts spoken commentary to text and saves it into the SQLite database.")
    ]
    
    for idx, (title, desc) in enumerate(sol_steps):
        p_c = tf_r.paragraphs[0] if idx == 0 else tf_r.add_paragraph()
        p_c.space_before = Pt(12)
        run1 = p_c.add_run()
        run1.text = f"•   {title}\n"
        run1.font.bold = True
        run1.font.size = Pt(15)
        run1.font.color.rgb = title_color
        run2 = p_c.add_run()
        run2.text = f"    {desc}"
        run2.font.size = Pt(13)
        run2.font.color.rgb = text_color

    # ==================== SLIDE 4: Key Features ====================
    s4 = prs.slides.add_slide(blank_layout)
    set_slide_background(s4)
    add_slide_header(s4, "Key Features & Functional Modules")
    
    left_box = s4.shapes.add_textbox(Inches(0.8), Inches(1.8), Inches(4.5), Inches(4.5))
    tf_l = left_box.text_frame
    tf_l.word_wrap = True
    p_l = tf_l.paragraphs[0]
    p_l.text = "Modern Closed-Loop Dashboard"
    p_l.font.size = Pt(22)
    p_l.font.bold = True
    p_l.font.color.rgb = text_color
    
    p_l2 = tf_l.add_paragraph()
    p_l2.text = "The application features an interactive, unified control center for machine operator capture, supervisors, and administrative analysis."
    p_l2.font.size = Pt(14)
    p_l2.font.color.rgb = sub_color
    p_l2.space_before = Pt(14)
    
    right_box = s4.shapes.add_textbox(Inches(5.8), Inches(1.8), Inches(6.8), Inches(4.5))
    tf_r = right_box.text_frame
    tf_r.word_wrap = True
    
    features = [
        ("Real-time Live Stream & Telemetry Overlay", "Operators can monitor the live camera feed with an overlaid machine state bar (LIVE, OFFLINE, RUNNING, RECORDING)."),
        ("Interactive Event Report Library", "Chronological list of all stoppages, showing duration, file sizes, breakdown type, and action buttons."),
        ("Voice Recording Dialog & Playback", "Voice overlay popup allows recording comments directly over recorded stoppage footage."),
        ("Excel & CSV Export with Video Links", "Generate analytical summaries in standard Excel spreadsheets containing direct hyperlinks to files.")
    ]
    
    for idx, (title, desc) in enumerate(features):
        p_c = tf_r.paragraphs[0] if idx == 0 else tf_r.add_paragraph()
        p_c.space_before = Pt(12)
        run1 = p_c.add_run()
        run1.text = f"•   {title}\n"
        run1.font.bold = True
        run1.font.size = Pt(15)
        run1.font.color.rgb = title_color
        run2 = p_c.add_run()
        run2.text = f"    {desc}"
        run2.font.size = Pt(13)
        run2.font.color.rgb = text_color

    # ==================== SLIDE 5: Architecture Flow ====================
    s5 = prs.slides.add_slide(blank_layout)
    set_slide_background(s5)
    add_slide_header(s5, "System Architecture & Data Flow")
    
    # Left Box: Description
    left_box = s5.shapes.add_textbox(Inches(0.8), Inches(1.8), Inches(4.0), Inches(4.5))
    tf_l = left_box.text_frame
    tf_l.word_wrap = True
    p_l = tf_l.paragraphs[0]
    p_l.text = "Robust Multi-Threaded Architecture"
    p_l.font.size = Pt(22)
    p_l.font.bold = True
    p_l.font.color.rgb = text_color
    
    p_l2 = tf_l.add_paragraph()
    p_l2.text = "The system decouples network and hardware operations into distinct asynchronous workers to prevent blocking and lag."
    p_l2.font.size = Pt(14)
    p_l2.font.color.rgb = sub_color
    p_l2.space_before = Pt(14)
    
    # Right Box: Component Bullet Points
    right_box = s5.shapes.add_textbox(Inches(5.2), Inches(1.8), Inches(7.3), Inches(4.5))
    tf_r = right_box.text_frame
    tf_r.word_wrap = True
    
    components = [
        ("Mitsubishi PLC Connection (SLMP/TCP)", "Connects via Single-cell Link Message Protocol over Ethernet to monitor machine coil states in real time."),
        ("RTSP Live Stream Cache & Multiplexer", "Python thread caches the RTSP feed to memory. Serving local users without overload on the camera."),
        ("SQLite with WAL (Write-Ahead Logging)", "Database writes are fast, non-blocking, and concurrent. Prevents table locks during heavy recording events."),
        ("Asynchronous AI Whisper Pipeline", "Audio extraction, VAD noise isolation, and transcription run inside a separate background thread.")
    ]
    
    for idx, (title, desc) in enumerate(components):
        p_c = tf_r.paragraphs[0] if idx == 0 else tf_r.add_paragraph()
        p_c.space_before = Pt(12)
        run1 = p_c.add_run()
        run1.text = f"•   {title}\n"
        run1.font.bold = True
        run1.font.size = Pt(15)
        run1.font.color.rgb = title_color
        run2 = p_c.add_run()
        run2.text = f"    {desc}"
        run2.font.size = Pt(13)
        run2.font.color.rgb = text_color

    # ==================== SLIDE 6: Why This is the Best ====================
    s6 = prs.slides.add_slide(blank_layout)
    set_slide_background(s6)
    add_slide_header(s6, "Why This is the Best Technical Choice")
    
    left_box = s6.shapes.add_textbox(Inches(0.8), Inches(1.8), Inches(4.5), Inches(4.5))
    tf_l = left_box.text_frame
    tf_l.word_wrap = True
    p_l = tf_l.paragraphs[0]
    p_l.text = "Highly Optimized & Stable Design"
    p_l.font.size = Pt(22)
    p_l.font.bold = True
    p_l.font.color.rgb = text_color
    
    p_l2 = tf_l.add_paragraph()
    p_l2.text = "Engineered specifically for the harsh conditions of factory environments where network loss and power outages are common."
    p_l2.font.size = Pt(14)
    p_l2.font.color.rgb = sub_color
    p_l2.space_before = Pt(14)
    
    right_box = s6.shapes.add_textbox(Inches(5.8), Inches(1.8), Inches(6.8), Inches(4.5))
    tf_r = right_box.text_frame
    tf_r.word_wrap = True
    
    advantages = [
        ("Microscopic RAM Usage (~73 MB)", "Extremely lightweight footprint. Runs smoothly on simple industrial PCs alongside other processes."),
        ("Camera Session Caching", "Protects IP camera from hardware failure by ensuring only one RTSP stream is pulled globally."),
        ("Silero VAD Speech Filtering", "VAD isolates voice frequencies, ignoring loud machine clangs, hums, and general warehouse noise."),
        ("Automatic Startup Self-Repair", "Automatically closes and updates ghost 'running' logs left open by sudden power losses.")
    ]
    
    for idx, (title, desc) in enumerate(advantages):
        p_c = tf_r.paragraphs[0] if idx == 0 else tf_r.add_paragraph()
        p_c.space_before = Pt(12)
        run1 = p_c.add_run()
        run1.text = f"•   {title}\n"
        run1.font.bold = True
        run1.font.size = Pt(15)
        run1.font.color.rgb = title_color
        run2 = p_c.add_run()
        run2.text = f"    {desc}"
        run2.font.size = Pt(13)
        run2.font.color.rgb = text_color

    # ==================== SLIDE 7: Future Roadmap ====================
    s7 = prs.slides.add_slide(blank_layout)
    set_slide_background(s7)
    add_slide_header(s7, "Future Roadmap & Expansion Plan")
    
    left_box = s7.shapes.add_textbox(Inches(0.8), Inches(1.8), Inches(4.5), Inches(4.5))
    tf_l = left_box.text_frame
    tf_l.word_wrap = True
    p_l = tf_l.paragraphs[0]
    p_l.text = "Scaling the Smart Factory"
    p_l.font.size = Pt(22)
    p_l.font.bold = True
    p_l.font.color.rgb = text_color
    
    p_l2 = tf_l.add_paragraph()
    p_l2.text = "Our software architecture is built modularly, making it easy to scale across multiple machines, lines, and advanced AI services."
    p_l2.font.size = Pt(14)
    p_l2.font.color.rgb = sub_color
    p_l2.space_before = Pt(14)
    
    right_box = s7.shapes.add_textbox(Inches(5.8), Inches(1.8), Inches(6.8), Inches(4.5))
    tf_r = right_box.text_frame
    tf_r.word_wrap = True
    
    roadmap = [
        ("Multi-Machine / Multi-Camera Scale", "Monitor multiple production cells from a single industrial backend server via centralized WebSockets."),
        ("Predictive Failure Analysis", "Analyze operator voice logs to predict tool wear, motor breakdowns, or common component failure points."),
        ("Natural Language Chat Queries (LLM)", "Implement a localized LLM search bar for managers to ask questions like: 'How many breakdowns were caused by tooling this week?'")
    ]
    
    for idx, (title, desc) in enumerate(roadmap):
        p_c = tf_r.paragraphs[0] if idx == 0 else tf_r.add_paragraph()
        p_c.space_before = Pt(15)
        run1 = p_c.add_run()
        run1.text = f"•   {title}\n"
        run1.font.bold = True
        run1.font.size = Pt(16)
        run1.font.color.rgb = title_color
        run2 = p_c.add_run()
        run2.text = f"    {desc}"
        run2.font.size = Pt(14)
        run2.font.color.rgb = text_color

    # Save presentation
    output_path = r"c:\Users\Admin\OneDrive - ricoauto.in\Desktop\Live_Project\Camera-WebApp\PROJECT_PRESENTATION.pptx"
    prs.save(output_path)
    print(f"Presentation saved successfully to {output_path}")

if __name__ == "__main__":
    create_deck()
