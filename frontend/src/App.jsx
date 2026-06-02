import React, { useState, useEffect, useRef } from "react";
import { FaDownload, FaTrash, FaSpinner, FaCheckCircle, FaExclamationCircle, FaTimes } from "react-icons/fa";
import { MdVideoLibrary, MdAdd, MdPlaylistAdd } from "react-icons/md";
import api from "./Axios";
import "bootstrap/dist/css/bootstrap.min.css";
import "./App.css";

const App = () => {
  const [urls, setUrls] = useState([""]);
  const [downloads, setDownloads] = useState([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [error, setError] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const errorTimeoutRef = useRef(null);
  const abortControllers = useRef([]);

  // Clear error after 5 seconds
  useEffect(() => {
    if (error) {
      errorTimeoutRef.current = setTimeout(() => {
        setError("");
      }, 5000);
    }
    return () => {
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current);
      }
      // Abort any ongoing requests on unmount
      abortControllers.current.forEach(controller => controller.abort());
    };
  }, [error]);

  // Clear form function
  const clearForm = () => {
    setUrls([""]);
  };

  // Add new URL input field
  const addUrlField = () => {
    setUrls([...urls, ""]);
  };

  // Remove URL input field
  const removeUrlField = (index) => {
    const newUrls = urls.filter((_, i) => i !== index);
    setUrls(newUrls.length ? newUrls : [""]);
  };

  // Update URL at specific index
  const updateUrl = (index, value) => {
    const newUrls = [...urls];
    newUrls[index] = value;
    setUrls(newUrls);
  };

  // Validate URLs before submission
  const validateUrls = () => {
    const validUrls = urls.filter(url => url.trim() !== "");
    if (validUrls.length === 0) {
      setError("❌ Please add at least one video URL");
      return false;
    }
    
    // Simple URL validation
    const invalidUrls = validUrls.filter(url => {
      try {
        new URL(url);
        return false;
      } catch {
        return true;
      }
    });
    
    if (invalidUrls.length > 0) {
      setError(`❌ Invalid URL format in ${invalidUrls.length} link(s)`);
      return false;
    }
    
    return true;
  };

  // Format URL for display (remove https:// and slice)
  const formatUrlForDisplay = (url) => {
    let displayUrl = url.replace(/^https?:\/\//, '');
    if (displayUrl.length > 40) {
      displayUrl = displayUrl.substring(0, 37) + '...';
    }
    return displayUrl;
  };

  // Download a single video with progress
  const downloadVideo = async (downloadItem, updateProgress, onComplete) => {
    const abortController = new AbortController();
    abortControllers.current.push(abortController);
    
    try {
      const response = await api.post(
        "/batch-download",
        { url: downloadItem.url },
        {
          responseType: "blob",
          signal: abortController.signal,
          onDownloadProgress: (progressEvent) => {
            if (progressEvent.total) {
              const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
              updateProgress(percent);
            }
          },
        }
      );
      
      // Get filename from Content-Disposition header
      const contentDisposition = response.headers["content-disposition"];
      let fileName = `video_${Date.now()}.mp4`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (match && match[1]) {
          fileName = match[1].replace(/['"]/g, '');
        }
      }
      
      // Create download link and trigger download
      const blob = new Blob([response.data], { type: 'video/mp4' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      onComplete(true, fileName);
      return { success: true, fileName };
      
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('Download aborted');
        return { success: false, error: 'Download cancelled' };
      }
      console.error(`Error downloading:`, err);
      const errorMsg = err.response?.data?.message || err.message || "Download failed";
      onComplete(false, null, errorMsg);
      return { success: false, error: errorMsg };
    }
  };

  // Handle batch download submission
  const handleBatchSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateUrls()) return;
    
    setBatchLoading(true);
    setError("");
    
    const validUrls = urls.filter(url => url.trim() !== "");
    const downloadItems = validUrls.map((url, index) => ({
      id: `${Date.now()}_${index}`,
      url: url.trim(),
      status: "pending",
      progress: 0,
      fileName: "",
      error: null,
    }));
    
    setDownloads(downloadItems);
    
    let allSuccess = true;
    
    // Process downloads sequentially
    for (let i = 0; i < downloadItems.length; i++) {
      const downloadItem = downloadItems[i];
      
      // Update status to downloading
      setDownloads(prev => prev.map(item => 
        item.id === downloadItem.id ? { ...item, status: "downloading", progress: 0 } : item
      ));
      
      // Download the video
      await downloadVideo(
        downloadItem,
        (percent) => {
          // Update progress
          setDownloads(prev => prev.map(item => 
            item.id === downloadItem.id ? { ...item, progress: percent } : item
          ));
        },
        (success, fileName, errorMsg) => {
          // Update final status
          setDownloads(prev => prev.map(item => 
            item.id === downloadItem.id ? { 
              ...item, 
              status: success ? "completed" : "failed",
              progress: success ? 100 : 0,
              fileName: fileName || item.fileName,
              error: errorMsg || null
            } : item
          ));
          if (!success) allSuccess = false;
        }
      );
      
      // Small delay between downloads
      if (i < downloadItems.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
    
    setBatchLoading(false);
    
    // Clear the form if all downloads were successful
    if (allSuccess) {
      setTimeout(() => {
        clearForm();
      }, 1000);
    }
  };

  // Retry failed download
  const retryDownload = async (downloadId) => {
    const download = downloads.find(d => d.id === downloadId);
    if (!download) return;
    
    setDownloads(prev => prev.map(item => 
      item.id === downloadId ? { ...item, status: "pending", progress: 0, error: null } : item
    ));
    
    // Update status to downloading
    setDownloads(prev => prev.map(item => 
      item.id === downloadId ? { ...item, status: "downloading", progress: 0 } : item
    ));
    
    // Retry download
    await downloadVideo(
      download,
      (percent) => {
        setDownloads(prev => prev.map(item => 
          item.id === downloadId ? { ...item, progress: percent } : item
        ));
      },
      (success, fileName, errorMsg) => {
        setDownloads(prev => prev.map(item => 
          item.id === downloadId ? { 
            ...item, 
            status: success ? "completed" : "failed",
            progress: success ? 100 : 0,
            fileName: fileName || item.fileName,
            error: errorMsg || null
          } : item
        ));
      }
    );
  };

  // Get status icon
  const getStatusIcon = (status) => {
    switch(status) {
      case "downloading":
        return <FaSpinner className="spin" style={{ color: "#000000" }} size={12} />;
      case "completed":
        return <FaCheckCircle style={{ color: "#000000" }} size={12} />;
      case "failed":
        return <FaExclamationCircle style={{ color: "#000000" }} size={12} />;
      default:
        return <div className="spinner-border spinner-border-sm" style={{ color: "#000000", width: "12px", height: "12px" }} role="status">
          <span className="visually-hidden">Pending</span>
        </div>;
    }
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#ffffff", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* Navbar - Minimal Black & White */}
      <nav style={{ 
        backgroundColor: "#ffffff", 
        borderBottom: "1px solid #e5e5e5",
        position: "sticky",
        top: 0,
        zIndex: 1000,
      }}>
        <div style={{
          maxWidth: "1200px",
          margin: "0 auto",
          padding: "0.75rem 1rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}>
          <div 
            style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          >
            <div style={{
              width: "32px",
              height: "32px",
              backgroundColor: "#000000",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}>
              <MdVideoLibrary style={{ color: "#ffffff", fontSize: "18px" }} />
            </div>
            <span style={{
              fontSize: "1rem",
              fontWeight: 600,
              color: "#000000",
              letterSpacing: "-0.025em",
            }}>
              Batch Video Downloader
            </span>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div style={{ 
        maxWidth: "600px", 
        margin: "0 auto", 
        padding: "1.5rem 1rem",
        width: "100%",
        boxSizing: "border-box"
      }}>
        <div style={{
          backgroundColor: "#ffffff",
          borderRadius: "12px",
          border: "1px solid #e5e5e5",
          padding: "1.5rem",
          width: "100%",
          boxSizing: "border-box"
        }}>
          <h2 style={{
            fontSize: "1.5rem",
            fontWeight: 600,
            color: "#000000",
            marginBottom: "1rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
            flexWrap: "wrap",
          }}>
            <MdPlaylistAdd style={{ color: "#000000" }} size={28} />
            Batch Video Downloader
          </h2>
          
          <p style={{
            textAlign: "center",
            color: "#6c757d",
            marginBottom: "1.5rem",
            fontSize: "0.8rem",
          }}>
            Paste multiple video URLs and download them all at once
          </p>
          
          <form onSubmit={handleBatchSubmit}>
            <div style={{ marginBottom: "1.5rem" }}>
              <label style={{
                display: "block",
                marginBottom: "0.5rem",
                fontWeight: 500,
                fontSize: "0.8rem",
                color: "#000000",
              }}>
                Video URLs
              </label>
              {urls.map((url, index) => (
                <div key={index} style={{ 
                  display: "flex", 
                  gap: "0.5rem", 
                  marginBottom: "0.75rem",
                  flexWrap: "nowrap",
                }}>
                  <input
                    type="url"
                    style={{
                      flex: 1,
                      padding: "0.5rem 0.75rem",
                      border: "1px solid #e5e5e5",
                      borderRadius: "6px",
                      fontSize: "0.8rem",
                      outline: "none",
                      transition: "border-color 0.2s",
                      fontFamily: "inherit",
                      minWidth: 0,
                    }}
                    value={url}
                    onChange={(e) => updateUrl(index, e.target.value)}
                    placeholder="https://youtube.com/watch?v=..."
                    disabled={batchLoading}
                    onFocus={(e) => e.target.style.borderColor = "#000000"}
                    onBlur={(e) => e.target.style.borderColor = "#e5e5e5"}
                  />
                  <button
                    type="button"
                    style={{
                      padding: "0.5rem 0.75rem",
                      backgroundColor: "#ffffff",
                      color: "#000000",
                      border: "1px solid #e5e5e5",
                      borderRadius: "6px",
                      cursor: urls.length === 1 || batchLoading ? "not-allowed" : "pointer",
                      opacity: urls.length === 1 || batchLoading ? 0.5 : 1,
                      transition: "background-color 0.2s",
                      flexShrink: 0,
                    }}
                    onClick={() => removeUrlField(index)}
                    disabled={urls.length === 1 || batchLoading}
                  >
                    <FaTrash size={12} />
                  </button>
                </div>
              ))}
              
              <button
                type="button"
                style={{
                  marginTop: "0.75rem",
                  padding: "0.4rem 0.8rem",
                  backgroundColor: "#ffffff",
                  color: "#000000",
                  border: "1px solid #e5e5e5",
                  borderRadius: "6px",
                  fontSize: "0.8rem",
                  fontWeight: 500,
                  cursor: batchLoading ? "not-allowed" : "pointer",
                  opacity: batchLoading ? 0.5 : 1,
                  transition: "background-color 0.2s",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
                onClick={addUrlField}
                disabled={batchLoading}
              >
                <MdAdd size={14} />
                Add Another URL
              </button>
            </div>
            
            {error && (
              <div style={{
                backgroundColor: "#f8f9fa",
                border: "1px solid #e5e5e5",
                borderRadius: "6px",
                padding: "0.6rem",
                marginBottom: "1rem",
                color: "#000000",
                fontSize: "0.8rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.5rem",
                flexWrap: "wrap",
              }}>
                <span style={{ wordBreak: "break-word" }}>❌ {error}</span>
                <button type="button" onClick={() => setError("")} style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#000000",
                  flexShrink: 0,
                }}>
                  <FaTimes size={12} />
                </button>
              </div>
            )}
            
            <button
              type="submit"
              style={{
                width: "100%",
                padding: "0.6rem",
                backgroundColor: "#000000",
                color: "#ffffff",
                border: "none",
                borderRadius: "6px",
                fontSize: "0.85rem",
                fontWeight: 500,
                cursor: batchLoading ? "not-allowed" : "pointer",
                opacity: batchLoading ? 0.7 : 1,
                transition: "opacity 0.2s",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem",
              }}
              disabled={batchLoading}
            >
              {batchLoading ? (
                <>
                  <FaSpinner className="spin" size={12} />
                  Processing Batch...
                </>
              ) : (
                <>
                  <FaDownload size={12} />
                  Download All Videos ({urls.filter(u => u.trim()).length})
                </>
              )}
            </button>
          </form>
          
          {/* Download Queue */}
          {downloads.length > 0 && (
            <div style={{ marginTop: "2rem" }}>
              <h5 style={{
                marginBottom: "0.75rem",
                fontSize: "0.9rem",
                fontWeight: 600,
                color: "#000000",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}>
                Download Queue
                <span style={{
                  backgroundColor: "#f8f9fa",
                  padding: "0.2rem 0.4rem",
                  borderRadius: "4px",
                  fontSize: "0.7rem",
                  color: "#000000",
                }}>
                  {downloads.length}
                </span>
              </h5>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {downloads.map((download) => (
                  <div key={download.id} style={{
                    border: "1px solid #e5e5e5",
                    borderRadius: "8px",
                    padding: "0.75rem",
                    backgroundColor: "#ffffff",
                  }}>
                    {/* URL and Status - Responsive layout */}
                    <div style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.5rem",
                    }}>
                      <div style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: "0.5rem",
                        flexWrap: "wrap",
                      }}>
                        <span style={{
                          fontSize: "0.8rem",
                          color: "#000000",
                          fontWeight: 500,
                          wordBreak: "break-word",
                          flex: 1,
                        }}>
                          {formatUrlForDisplay(download.url)}
                        </span>
                        
                        <div style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          flexShrink: 0,
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                            {getStatusIcon(download.status)}
                            <span style={{
                              fontSize: "0.7rem",
                              color: "#6c757d",
                              textTransform: "capitalize",
                            }}>
                              {download.status}
                            </span>
                          </div>
                          
                          {download.status === "failed" && (
                            <button
                              style={{
                                padding: "0.25rem 0.5rem",
                                backgroundColor: "#ffffff",
                                color: "#000000",
                                border: "1px solid #e5e5e5",
                                borderRadius: "4px",
                                fontSize: "0.7rem",
                                fontWeight: 500,
                                cursor: "pointer",
                                transition: "background-color 0.2s",
                              }}
                              onClick={() => retryDownload(download.id)}
                            >
                              Retry
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    {/* Progress Bar */}
                    {(download.status === "downloading" || download.status === "pending") && (
                      <div style={{ marginTop: "0.5rem" }}>
                        <div style={{
                          backgroundColor: "#f8f9fa",
                          borderRadius: "6px",
                          overflow: "hidden",
                          height: "3px",
                        }}>
                          <div style={{
                            width: `${download.progress}%`,
                            backgroundColor: "#000000",
                            height: "100%",
                            transition: "width 0.3s ease",
                          }} />
                        </div>
                        <p style={{
                          textAlign: "center",
                          color: "#6c757d",
                          fontSize: "0.65rem",
                          marginTop: "0.35rem",
                          marginBottom: 0,
                        }}>
                          {download.progress}% Downloaded
                        </p>
                      </div>
                    )}
                    
                    {/* Error Message */}
                    {download.error && (
                      <div style={{
                        backgroundColor: "#f8f9fa",
                        border: "1px solid #e5e5e5",
                        borderRadius: "4px",
                        padding: "0.4rem",
                        marginTop: "0.5rem",
                      }}>
                        <small style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.3rem",
                          color: "#000000",
                          fontSize: "0.7rem",
                          wordBreak: "break-word",
                        }}>
                          <FaExclamationCircle size={10} />
                          {download.error}
                        </small>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      
      <style>
        {`
          .spin {
            animation: spin 1s linear infinite;
          }
          
          @keyframes spin {
            from {
              transform: rotate(0deg);
            }
            to {
              transform: rotate(360deg);
            }
          }
          
          /* Responsive adjustments */
          @media (max-width: 480px) {
            div[style*="max-width: 600px"] {
              padding: 1rem 0.75rem !important;
            }
          }
        `}
      </style>
    </div>
  );
};

export default App;